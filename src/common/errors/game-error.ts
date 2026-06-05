// Códigos de erro do domínio. O gateway traduz cada um em um evento `error`
// `{ code, message }` enviado ao remetente, sem alterar o estado da sessão.
export enum ErrorCode {
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_FULL = 'SESSION_FULL',
  SESSION_ALREADY_STARTED = 'SESSION_ALREADY_STARTED',
  INVALID_NAME = 'INVALID_NAME',
  NOT_HOST = 'NOT_HOST',
  NOT_ENOUGH_PLAYERS = 'NOT_ENOUGH_PLAYERS',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  GAME_NOT_ACTIVE = 'GAME_NOT_ACTIVE',
  NOT_IN_SESSION = 'NOT_IN_SESSION',
  // --- Sprint 2: fluxo de pergunta ---
  NO_PENDING_QUESTION = 'NO_PENDING_QUESTION',
  QUESTION_MISMATCH = 'QUESTION_MISMATCH',
  INVALID_OPTION = 'INVALID_OPTION',
  // Erro inesperado/não-domínio. Mantido no enum para o payload `error` ser sempre tipado.
  INTERNAL = 'INTERNAL',
}

// Mensagens padrão (PT-BR) por código. O front pode sobrescrever pela UI.
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.SESSION_NOT_FOUND]: 'Sessão não encontrada.',
  [ErrorCode.SESSION_FULL]: 'A sessão está cheia (máximo de 4 jogadores).',
  [ErrorCode.SESSION_ALREADY_STARTED]: 'A partida já foi iniciada.',
  [ErrorCode.INVALID_NAME]: 'Nome inválido.',
  [ErrorCode.NOT_HOST]: 'Apenas o host pode iniciar a partida.',
  [ErrorCode.NOT_ENOUGH_PLAYERS]: 'São necessários ao menos 2 jogadores.',
  [ErrorCode.NOT_YOUR_TURN]: 'Não é a sua vez.',
  [ErrorCode.GAME_NOT_ACTIVE]: 'A partida não está em andamento.',
  [ErrorCode.NOT_IN_SESSION]: 'Você não faz parte desta sessão.',
  [ErrorCode.NO_PENDING_QUESTION]: 'Não há pergunta pendente para responder.',
  [ErrorCode.QUESTION_MISMATCH]:
    'A pergunta enviada não corresponde à pendente.',
  [ErrorCode.INVALID_OPTION]: 'Alternativa inválida.',
  [ErrorCode.INTERNAL]: 'Erro interno.',
};

// Erro de regra de jogo. Carrega um ErrorCode estável para o contrato WS.
export class GameError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.code = code;
    this.name = 'GameError';
  }
}
