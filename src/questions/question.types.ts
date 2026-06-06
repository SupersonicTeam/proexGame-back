// Tipos do banco de perguntas (Sprint 2).
// Carregados de /questions/<subject>.json no boot e servidos em memória.

// Matéria de uma pergunta (ex.: 'matematica'). String aberta: as matérias
// disponíveis são determinadas pelos arquivos JSON presentes no banco.
export type Subject = string;

// Pergunta crua do banco. `correct`/`proximal`/`wrong` NUNCA são enviados
// ao client juntos: ao servir, as opções são embaralhadas em PendingQuestion.
export interface Question {
  id: string;
  subject: Subject;
  statement: string;
  correct: string;
  proximal: string;
  wrong: [string, string]; // exatamente 2 distratores totais
}

// Estado autoritativo da pergunta servida a um jogador.
// SEGURANÇA (RF-16): `correctIndex`/`proximalIndex` vivem só no servidor (Redis);
// a projeção para o client (toQuestionPrompt) jamais inclui esses campos.
export interface PendingQuestion {
  questionId: string;
  subject: Subject;
  statement: string; // público (vai no prompt) — não é segredo
  options: string[]; // 4 alternativas embaralhadas
  correctIndex: number; // segredo do servidor
  proximalIndex: number; // segredo do servidor
}
