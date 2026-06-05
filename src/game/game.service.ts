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
import { generateBoard } from './board.rules';
import {
  buildRanking,
  nextConnectedTurnIndex,
  resolveCorrectMovement,
  resolveErrorMovement,
  resolveMovement,
  resolveOrder,
  rollDie,
} from './game.rules';
import {
  buildPendingQuestion,
  classifyAnswer,
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

export interface SubmitAnswerResult {
  state: SessionState;
  playerId: string;
  correct: boolean;
  errorType: 'none' | 'proximal' | 'wrong';
  fromSquare: number;
  toSquare: number;
  movement: number; // delta de casas (negativo no recuo)
  isWin: boolean;
  nextPlayerId: string | null; // null quando encadeou nova pergunta ou venceu
  ranking: RankingEntry[] | null;
  prompt: QuestionPromptView | null; // nova pergunta quando há encadeamento (RF-11)
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

  // Gera o tabuleiro procedural da partida (RF-06/07/17/18) e persiste. Roda no
  // início da partida, antes de resolver a ordem. Usa as matérias disponíveis no
  // banco para as casas-pergunta. Fica aqui (e não no SessionService) porque o
  // GameService já possui rng + QuestionBank — evita dependência circular.
  async setupBoard(code: string): Promise<SessionState> {
    const state = await this.requireSession(code);
    state.board = generateBoard(
      state.difficulty,
      this.questionBank.subjects(),
      this.rng,
    );
    await this.repo.save(state);
    return state;
  }

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

  // Processa a resposta do jogador à pergunta pendente (RF-08/10/11/16).
  // Valida pendência/identidade/limites, classifica, aplica movimento e —
  // no acerto — encadeia nova pergunta se cair em casa-pergunta (sem trocar turno).
  async submitAnswer(
    code: string,
    playerId: string,
    questionId: string,
    optionIndex: number,
  ): Promise<SubmitAnswerResult> {
    const state = await this.requireSession(code);
    if (state.status !== 'playing' || state.turnOrder.length === 0) {
      throw new GameError(ErrorCode.GAME_NOT_ACTIVE);
    }
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.pendingQuestion) {
      throw new GameError(ErrorCode.NO_PENDING_QUESTION);
    }
    const pending = player.pendingQuestion;
    if (pending.questionId !== questionId) {
      throw new GameError(ErrorCode.QUESTION_MISMATCH);
    }
    if (
      !Number.isInteger(optionIndex) ||
      optionIndex < 0 ||
      optionIndex >= pending.options.length
    ) {
      throw new GameError(ErrorCode.INVALID_OPTION);
    }

    const errorType = classifyAnswer(pending, optionIndex);
    // Anti double-submit: limpa a pendência antes de aplicar o efeito.
    player.pendingQuestion = null;

    return errorType === 'none'
      ? this.applyCorrect(state, player)
      : this.applyError(state, player, errorType);
  }

  // Acerto: avança (tier/dificuldade + nudge), vence, encadeia ou passa o turno.
  private async applyCorrect(
    state: SessionState,
    player: Player,
  ): Promise<SubmitAnswerResult> {
    const movement = resolveCorrectMovement(state, player.id, this.rng);
    player.square = movement.toSquare;
    const base = {
      state,
      playerId: player.id,
      correct: true,
      errorType: 'none' as const,
      fromSquare: movement.fromSquare,
      toSquare: movement.toSquare,
      movement: movement.toSquare - movement.fromSquare,
    };

    if (movement.isWin) {
      state.status = 'finished';
      state.winner = player.id;
      const ranking = buildRanking(state, player.id);
      await this.repo.save(state);
      return {
        ...base,
        isWin: true,
        nextPlayerId: null,
        ranking,
        prompt: null,
      };
    }

    // Encadeamento (RF-11): se o avanço cair em casa-pergunta, dispara nova
    // pergunta sem trocar o turno. Avanço em presídio NÃO prende (RF-19).
    if (movement.tileType === 'question') {
      const prompt = this.tryStartQuestion(state, player, movement.toSquare);
      if (prompt) {
        await this.repo.save(state);
        return {
          ...base,
          isWin: false,
          nextPlayerId: null,
          ranking: null,
          prompt,
        };
      }
    }

    const nextPlayerId = this.passTurn(state);
    await this.repo.save(state);
    return { ...base, isWin: false, nextPlayerId, ranking: null, prompt: null };
  }

  // Erro: recua (clamp ≥1) e passa o turno. Recuo NÃO dispara nada (RF-08/19).
  private async applyError(
    state: SessionState,
    player: Player,
    errorType: 'proximal' | 'wrong',
  ): Promise<SubmitAnswerResult> {
    const movement = resolveErrorMovement(state, player.id, errorType);
    player.square = movement.toSquare;
    const nextPlayerId = this.passTurn(state);
    await this.repo.save(state);
    return {
      state,
      playerId: player.id,
      correct: false,
      errorType,
      fromSquare: movement.fromSquare,
      toSquare: movement.toSquare,
      movement: movement.toSquare - movement.fromSquare,
      isWin: false,
      nextPlayerId,
      ranking: null,
      prompt: null,
    };
  }

  // Avança o índice de turno para o próximo conectado e retorna seu playerId.
  private passTurn(state: SessionState): string {
    state.currentTurnIndex = nextConnectedTurnIndex(state);
    return state.turnOrder[state.currentTurnIndex];
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

  // Turno de presídio (RF-20): se o jogador da vez tem turnos a pular, decrementa
  // um, passa a vez SEM rolar e sinaliza turnSkipped{playerId, remaining}. O
  // gateway chama isto em laço após cada troca de turno (cobre presos em sequência).
  // Retorna null quando não há nada a pular.
  async startTurnSkipIfNeeded(code: string): Promise<{
    state: SessionState;
    playerId: string;
    remaining: number;
    nextPlayerId: string;
  } | null> {
    const state = await this.repo.findByCode(code);
    if (!state || state.status !== 'playing' || state.turnOrder.length === 0) {
      return null;
    }
    const currentId = state.turnOrder[state.currentTurnIndex];
    const current = state.players.find((p) => p.id === currentId);
    if (!current || current.skipTurns <= 0) return null;

    current.skipTurns -= 1;
    const remaining = current.skipTurns;
    const nextPlayerId = this.passTurn(state);
    await this.repo.save(state);
    return { state, playerId: currentId, remaining, nextPlayerId };
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
