import { RandomSource } from '../common/random/random.source';
import { PendingQuestion, Question } from '../questions/question.types';

// ---------------------------------------------------------------------------
// Regras puras de pergunta (RF-09/16). Embaralhamento das alternativas,
// classificação da resposta e projeção SEGURA para o client. Sem I/O.
//
// SEGURANÇA (RF-16): a alternativa correta nunca é distinguível no payload.
// `correctIndex`/`proximalIndex` ficam apenas em PendingQuestion (lado servidor);
// a projeção toQuestionPrompt jamais os inclui.
// ---------------------------------------------------------------------------

// Papel de cada alternativa durante o embaralhamento (uso interno).
type Role = 'correct' | 'proximal' | 'wrong';

/**
 * Monta a pergunta pendente a partir de uma Question crua: embaralha as 4
 * alternativas (1 correta, 1 proximal, 2 erradas) com Fisher-Yates usando o
 * RandomSource injetado, e registra onde a correta e a proximal caíram.
 */
export function buildPendingQuestion(
  q: Question,
  rng: RandomSource,
): PendingQuestion {
  const labeled: { text: string; role: Role }[] = [
    { text: q.correct, role: 'correct' },
    { text: q.proximal, role: 'proximal' },
    { text: q.wrong[0], role: 'wrong' },
    { text: q.wrong[1], role: 'wrong' },
  ];

  // Fisher-Yates: para cada posição do fim ao início, troca com uma posição
  // sorteada em [0, i]. Consome exatamente 3 valores do rng (determinístico).
  for (let i = labeled.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [labeled[i], labeled[j]] = [labeled[j], labeled[i]];
  }

  return {
    questionId: q.id,
    subject: q.subject,
    statement: q.statement,
    options: labeled.map((l) => l.text),
    correctIndex: labeled.findIndex((l) => l.role === 'correct'),
    proximalIndex: labeled.findIndex((l) => l.role === 'proximal'),
  };
}

// Classificação da resposta submetida: 'none' = acerto (sem erro), 'proximal' =
// distrator próximo, 'wrong' = erro total. Mapeia o índice escolhido aos papéis
// guardados no servidor (§3.5).
export function classifyAnswer(
  pending: PendingQuestion,
  optionIndex: number,
): 'none' | 'proximal' | 'wrong' {
  if (optionIndex === pending.correctIndex) return 'none';
  if (optionIndex === pending.proximalIndex) return 'proximal';
  return 'wrong';
}

// Payload público do prompt de pergunta — o ÚNICO caminho de projeção ao client.
export interface QuestionPromptView {
  questionId: string;
  statement: string;
  options: string[];
}

/**
 * Projeta a pergunta pendente para o client. Por construção, expõe apenas
 * questionId, statement e options embaralhadas — nunca os índices da correta/
 * proximal (RF-16). Toda emissão de questionPrompt DEVE passar por aqui.
 */
export function toQuestionPrompt(pending: PendingQuestion): QuestionPromptView {
  return {
    questionId: pending.questionId,
    statement: pending.statement,
    options: pending.options,
  };
}
