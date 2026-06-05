import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { QuestionBankService } from '../questions/question-bank.service';
import { SessionRepository } from '../session/session.repository';
import {
  Player,
  RankingEntry,
  Roll,
  SessionState,
} from '../session/session.types';
import {
  buildRanking,
  nextConnectedTurnIndex,
  resolveMovement,
  resolveOrder,
  rollDie,
} from './game.rules';
import {
  buildPendingQuestion,
  QuestionPromptView,
  toQuestionPrompt,
} from './question.rules';

export interface TurnOrderResult {
  state: SessionState;
  rolls: Roll[];
}

export interface ApplyDiceResult {
  state: SessionState;
  playerId: string;
  value: number;
  fromSquare: number;
  toSquare: number;
  isWin: boolean;
  nextPlayerId: string | null; // próximo a jogar (null quando há vitória OU pergunta pendente)
  ranking: RankingEntry[] | null; // preenchido apenas na vitória
  // Pergunta disparada pela aterrissagem (RF-08). Quando != null, o turno NÃO
  // passa: o jogador deve responder via submitAnswer antes de prosseguir.
  prompt: QuestionPromptView | null;
}

// Orquestra as regras puras (game.rules) com a persistência para os eventos
// de jogo. Toda decisão aleatória vem do servidor (RF-16).
@Injectable()
export class GameService {
  constructor(
    private readonly repo: SessionRepository,
    @Inject(RANDOM_SOURCE) private readonly rng: RandomSource,
    private readonly questionBank: QuestionBankService,
  ) {}

  // Resolve a ordem de turnos (RF-04) e posiciona o índice no primeiro jogador.
  async resolveTurnOrder(code: string): Promise<TurnOrderResult> {
    const state = await this.requireSession(code);
    const { turnOrder, rolls } = resolveOrder(
      state.players.map((p) => p.id),
      this.rng,
    );
    state.turnOrder = turnOrder;
    state.currentTurnIndex = 0;
    await this.repo.save(state);
    return { state, rolls };
  }

  // Aplica a rolagem do jogador da vez: move, detecta vitória ou passa o turno.
  async applyDiceRoll(
    code: string,
    playerId: string,
  ): Promise<ApplyDiceResult> {
    const state = await this.requireSession(code);
    // Não-ativo OU ordem ainda não resolvida → não há rolagem válida.
    if (state.status !== 'playing' || state.turnOrder.length === 0) {
      throw new GameError(ErrorCode.GAME_NOT_ACTIVE);
    }
    const currentPlayerId = state.turnOrder[state.currentTurnIndex];
    if (currentPlayerId !== playerId) {
      throw new GameError(ErrorCode.NOT_YOUR_TURN);
    }

    const value = rollDie(this.rng);
    const { fromSquare, toSquare, isWin, tileType } = resolveMovement(
      state,
      playerId,
      value,
    );

    const player = state.players.find((p) => p.id === playerId)!;
    player.square = toSquare;

    // Vitória (chega-ou-passa): encerra a partida imediatamente (RF-12).
    if (isWin) {
      state.status = 'finished';
      state.winner = playerId;
      const ranking = buildRanking(state, playerId);
      await this.repo.save(state);
      return this.diceResult(state, playerId, value, fromSquare, toSquare, {
        isWin: true,
        nextPlayerId: null,
        ranking,
        prompt: null,
      });
    }

    // Aterrissagem em casa-pergunta: dispara pergunta e NÃO passa o turno (RF-08).
    if (tileType === 'question') {
      const prompt = this.tryStartQuestion(state, player, toSquare);
      if (prompt) {
        await this.repo.save(state);
        return this.diceResult(state, playerId, value, fromSquare, toSquare, {
          isWin: false,
          nextPlayerId: null, // aguarda submitAnswer
          ranking: null,
          prompt,
        });
      }
      // Banco esgotado para a matéria: trata como casa normal (não trava o jogo).
    }

    // Aterrissagem em presídio via dado: perde a próxima jogada (RF-19/20).
    if (tileType === 'prison') {
      player.skipTurns += 1;
    }

    // Casa normal (ou fallbacks acima): passa o turno.
    state.currentTurnIndex = nextConnectedTurnIndex(state);
    await this.repo.save(state);
    return this.diceResult(state, playerId, value, fromSquare, toSquare, {
      isWin: false,
      nextPlayerId: state.turnOrder[state.currentTurnIndex],
      ranking: null,
      prompt: null,
    });
  }

  // Tenta selecionar uma pergunta para a casa de aterrissagem e arma a pendência
  // no jogador. Não-repetição GLOBAL na sessão (servedQuestionIds — RF-09/D3).
  // Retorna o prompt seguro (sem a resposta correta — RF-16) ou null se não há
  // matéria/pergunta disponível.
  private tryStartQuestion(
    state: SessionState,
    player: Player,
    square: number,
  ): QuestionPromptView | null {
    const subject = state.board.subjectBySquare[square];
    if (!subject) return null;
    const excluded = new Set(state.servedQuestionIds);
    const question = this.questionBank.pickQuestion(
      subject,
      excluded,
      this.rng,
    );
    if (!question) return null;

    const pending = buildPendingQuestion(question, this.rng);
    player.pendingQuestion = pending;
    state.servedQuestionIds.push(question.id);
    player.usedQuestionIds.push(question.id);
    return toQuestionPrompt(pending);
  }

  // Monta o ApplyDiceResult com os campos comuns + os específicos do caminho.
  private diceResult(
    state: SessionState,
    playerId: string,
    value: number,
    fromSquare: number,
    toSquare: number,
    rest: Pick<
      ApplyDiceResult,
      'isWin' | 'nextPlayerId' | 'ranking' | 'prompt'
    >,
  ): ApplyDiceResult {
    return { state, playerId, value, fromSquare, toSquare, ...rest };
  }

  // Se o jogador da vez está desconectado, passa o turno para o próximo
  // conectado (evita partida travada — S1-10). Retorna null se nada a fazer.
  async passTurnIfDisconnected(
    code: string,
  ): Promise<{ state: SessionState; nextPlayerId: string } | null> {
    const state = await this.repo.findByCode(code);
    // Sem partida ativa ou sem ordem definida → nada a passar (evita turnChanged{undefined}).
    if (!state || state.status !== 'playing' || state.turnOrder.length === 0) {
      return null;
    }
    const currentId = state.turnOrder[state.currentTurnIndex];
    const current = state.players.find((p) => p.id === currentId);
    if (current?.connected) return null; // ainda é a vez de alguém conectado
    state.currentTurnIndex = nextConnectedTurnIndex(state);
    await this.repo.save(state);
    return { state, nextPlayerId: state.turnOrder[state.currentTurnIndex] };
  }

  private async requireSession(code: string): Promise<SessionState> {
    const state = await this.repo.findByCode(code);
    if (!state) throw new GameError(ErrorCode.SESSION_NOT_FOUND);
    return state;
  }
}
