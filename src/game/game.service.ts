import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { QuestionBankService } from '../questions/question-bank.service';
import { SessionLock } from '../session/session.lock';
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
  rollDie,
} from './game.rules';
import {
  hasRolled,
  isOrderingResolved,
  isRoundComplete,
  orderingTurnOrder,
  playersToRoll,
  recordOrderRoll,
  resolveRound,
  startOrdering,
} from './ordering.rules';
import {
  buildPendingQuestion,
  classifyAnswer,
  QuestionPromptView,
  toQuestionPrompt,
} from './question.rules';

export interface BeginOrderingResult {
  state: SessionState;
  playersToRoll: string[];
}

// Resultado de uma rolagem da fase de ordem (RF-04). O gateway traduz em eventos:
// sempre `orderRoll`; e, ao completar a rodada, `orderResult` (finalize) OU um novo
// `orderPhase` (nextRound, quando ainda há empate a desfazer).
export interface OrderRollOutcome {
  state: SessionState;
  playerId: string;
  value: number;
  round: number;
  // Ordem totalmente resolvida → inicia a partida.
  finalize: {
    rounds: Roll[][];
    turnOrder: string[];
    firstPlayerId: string;
  } | null;
  // Rodada completou mas restou empate → nova rodada só entre os empatados.
  nextRound: { round: number; playersToRoll: string[] } | null;
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
  // RF-16-safe: revelado APÓS a submissão para a tela de resultado educativa.
  correctIndex: number;
}

// Orquestra as regras puras (game.rules) com a persistência para os eventos
// de jogo. Toda decisão aleatória vem do servidor (RF-16).
//
// Cada operação-folha de ESCRITA (setupBoard, beginOrdering, rollForOrder,
// applyDiceRoll, submitAnswer, startTurnSkipIfNeeded, passTurnIfDisconnected)
// roda sob SessionLock por `code` — a MESMA instância do SessionService, então a
// serialização por código é global entre os dois serviços (achado P2).
// autoRollPendingDisconnected é orquestrador e NÃO é envolvido: ele chama
// rollForOrder (que já trava), e travá-lo de novo causaria deadlock reentrante.
@Injectable()
export class GameService {
  constructor(
    private readonly repo: SessionRepository,
    @Inject(RANDOM_SOURCE) private readonly rng: RandomSource,
    private readonly questionBank: QuestionBankService,
    private readonly lock: SessionLock,
  ) {}

  // Gera o tabuleiro procedural da partida (RF-06/07/17/18) e persiste. Roda no
  // início da partida, antes de resolver a ordem. Usa as matérias disponíveis no
  // banco para as casas-pergunta. Fica aqui (e não no SessionService) porque o
  // GameService já possui rng + QuestionBank — evita dependência circular.
  async setupBoard(code: string): Promise<SessionState> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.requireSession(code);
      state.board = generateBoard(
        state.difficulty,
        this.questionBank.subjects(),
        this.rng,
      );
      await this.repo.save(state);
      return state;
    });
  }

  // Inicia a fase interativa de ordem (RF-04): zera a ordem anterior e cria o
  // estado de ordenação com todos empatados na rodada 1. Roda após setupBoard.
  // Retorna quem precisa rolar agora para o gateway emitir o primeiro orderPhase.
  async beginOrdering(code: string): Promise<BeginOrderingResult> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.requireSession(code);
      state.ordering = startOrdering(state.players.map((p) => p.id));
      state.turnOrder = [];
      state.currentTurnIndex = 0;
      await this.repo.save(state);
      return { state, playersToRoll: playersToRoll(state.ordering) };
    });
  }

  // Processa a rolagem de UM jogador na fase de ordem (RF-04). Valida que a fase
  // está ativa, que é a vez dele rolar e que ele ainda não rolou nesta rodada;
  // rola o d6 (autoridade do servidor — RF-16) e, ao completar a rodada, ou
  // finaliza a ordem (inicia a partida) ou abre nova rodada de desempate.
  async rollForOrder(
    code: string,
    playerId: string,
  ): Promise<OrderRollOutcome> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.requireSession(code);
      if (state.status !== 'ordering' || !state.ordering) {
        throw new GameError(ErrorCode.ORDER_NOT_ACTIVE);
      }
      if (!playersToRoll(state.ordering).includes(playerId)) {
        throw new GameError(ErrorCode.NOT_ROLLING_FOR_ORDER);
      }
      if (hasRolled(state.ordering, playerId)) {
        throw new GameError(ErrorCode.ALREADY_ROLLED_FOR_ORDER);
      }

      const value = rollDie(this.rng);
      state.ordering = recordOrderRoll(state.ordering, playerId, value);
      const round = state.ordering.round;

      let finalize: OrderRollOutcome['finalize'] = null;
      let nextRound: OrderRollOutcome['nextRound'] = null;

      if (isRoundComplete(state.ordering)) {
        state.ordering = resolveRound(state.ordering);
        if (isOrderingResolved(state.ordering)) {
          const turnOrder = orderingTurnOrder(state.ordering);
          const rounds = state.ordering.history;
          state.turnOrder = turnOrder;
          state.currentTurnIndex = 0;
          state.status = 'playing';
          state.ordering = null;
          finalize = { rounds, turnOrder, firstPlayerId: turnOrder[0] };
        } else {
          nextRound = {
            round: state.ordering.round,
            playersToRoll: playersToRoll(state.ordering),
          };
        }
      }

      await this.repo.save(state);
      return { state, playerId, value, round, finalize, nextRound };
    });
  }

  // Robustez (RF-04): se um jogador desconecta durante a ordenação e ainda devia
  // rolar, o servidor rola por ele para a fase não travar. Drena em laço (uma
  // auto-rolagem pode completar a rodada e expor novos pendentes desconectados).
  // Retorna os outcomes na ordem para o gateway emitir.
  async autoRollPendingDisconnected(code: string): Promise<OrderRollOutcome[]> {
    const outcomes: OrderRollOutcome[] = [];
    // Teto defensivo (nº de jogadores × rodadas) contra laço infinito teórico.
    for (let guard = 0; guard < 64; guard++) {
      const state = await this.repo.findByCode(code);
      if (!state || state.status !== 'ordering' || !state.ordering) break;
      const ordering = state.ordering;
      const target = playersToRoll(ordering).find((id) => {
        if (hasRolled(ordering, id)) return false;
        const player = state.players.find((p) => p.id === id);
        // Só auto-rola por quem AINDA está na sessão e desconectado. Um id que
        // não está mais em players (ex.: removido por expiração de grace) NÃO é
        // auto-rolado — senão a ordem resolveria com um fantasma no turnOrder.
        // Esse caso é tratado reiniciando a ordem (gateway) com os restantes.
        return player !== undefined && !player.connected;
      });
      if (!target) break;
      outcomes.push(await this.rollForOrder(code, target));
    }
    return outcomes;
  }

  // Aplica a rolagem do jogador da vez: move, detecta vitória ou passa o turno.
  async applyDiceRoll(
    code: string,
    playerId: string,
  ): Promise<ApplyDiceResult> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.requireSession(code);
      // Não-ativo OU ordem ainda não resolvida → não há rolagem válida.
      if (state.status !== 'playing' || state.turnOrder.length === 0) {
        throw new GameError(ErrorCode.GAME_NOT_ACTIVE);
      }
      const currentPlayerId = state.turnOrder[state.currentTurnIndex];
      if (currentPlayerId !== playerId) {
        throw new GameError(ErrorCode.NOT_YOUR_TURN);
      }

      const player = state.players.find((p) => p.id === playerId)!;
      // Pergunta pendente bloqueia novas rolagens (RF-08): o jogador deve
      // responder antes de agir de novo. Fecha o double-click em rollDice
      // quando a 1ª rolagem caiu em casa-pergunta — caso em que o turno NÃO
      // passou, então a checagem de NOT_YOUR_TURN sozinha não barraria a 2ª.
      if (player.pendingQuestion) {
        throw new GameError(ErrorCode.ANSWER_PENDING);
      }

      const value = rollDie(this.rng);
      const { fromSquare, toSquare, isWin, tileType } = resolveMovement(
        state,
        playerId,
        value,
      );

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
    return this.lock.runExclusive(code, async () => {
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
      // Captura correctIndex antes de limpar — incluído no answerResult (RF-16-safe).
      const correctIndex = pending.correctIndex;
      // Anti double-submit: limpa a pendência antes de aplicar o efeito. Sob o
      // SessionLock, uma 2ª submissão concorrente lê o estado já salvo (pendência
      // nula) e cai em NO_PENDING_QUESTION — uma única submissão é processada.
      player.pendingQuestion = null;

      return errorType === 'none'
        ? this.applyCorrect(state, player, correctIndex)
        : this.applyError(state, player, errorType, correctIndex);
    });
  }

  // Acerto: avança (tier/dificuldade + nudge), vence, encadeia ou passa o turno.
  private async applyCorrect(
    state: SessionState,
    player: Player,
    correctIndex: number,
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
      correctIndex,
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
    correctIndex: number,
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
      correctIndex,
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
      state.difficulty,
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
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (
        !state ||
        state.status !== 'playing' ||
        state.turnOrder.length === 0
      ) {
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
    });
  }

  // Se o jogador da vez está desconectado, passa o turno para o próximo
  // conectado (evita partida travada — S1-10). Retorna null se nada a fazer.
  async passTurnIfDisconnected(
    code: string,
  ): Promise<{ state: SessionState; nextPlayerId: string } | null> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      // Sem partida ativa ou sem ordem definida → nada a passar (evita turnChanged{undefined}).
      if (
        !state ||
        state.status !== 'playing' ||
        state.turnOrder.length === 0
      ) {
        return null;
      }
      const currentId = state.turnOrder[state.currentTurnIndex];
      const current = state.players.find((p) => p.id === currentId);
      if (current?.connected) return null; // ainda é a vez de alguém conectado
      state.currentTurnIndex = nextConnectedTurnIndex(state);
      await this.repo.save(state);
      return { state, nextPlayerId: state.turnOrder[state.currentTurnIndex] };
    });
  }

  private async requireSession(code: string): Promise<SessionState> {
    const state = await this.repo.findByCode(code);
    if (!state) throw new GameError(ErrorCode.SESSION_NOT_FOUND);
    return state;
  }
}
