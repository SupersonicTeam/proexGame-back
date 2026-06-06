import { RandomSource } from '../common/random/random.source';
import { Question } from '../questions/question.types';
import {
  buildPendingQuestion,
  classifyAnswer,
  toQuestionPrompt,
} from './question.rules';

// Fonte determinística: int() devolve o próximo valor da fila (ignora min/max).
class FakeRandomSource implements RandomSource {
  private queue: number[];
  constructor(values: number[]) {
    this.queue = [...values];
  }
  int(): number {
    if (this.queue.length === 0) throw new Error('FakeRandomSource esgotada');
    return this.queue.shift() as number;
  }
  rollD6(): number {
    return this.int();
  }
}

const QUESTION: Question = {
  id: 'mat-0001',
  subject: 'matematica',
  statement: 'Quanto é 2 + 2?',
  correct: '4',
  proximal: '3',
  wrong: ['5', '22'],
};

describe('buildPendingQuestion', () => {
  it('embaralha as 4 alternativas e rastreia correct/proximal', () => {
    // Fisher-Yates (i=3,2,1) com j=i → nenhuma troca: ordem original preservada.
    const pending = buildPendingQuestion(
      QUESTION,
      new FakeRandomSource([3, 2, 1]),
    );
    expect(pending.options).toEqual(['4', '3', '5', '22']);
    expect(pending.correctIndex).toBe(0);
    expect(pending.proximalIndex).toBe(1);
    expect(pending.questionId).toBe('mat-0001');
    expect(pending.subject).toBe('matematica');
    expect(pending.statement).toBe('Quanto é 2 + 2?');
  });

  it('reposiciona os índices conforme o embaralhamento', () => {
    // j=0 em todas as iterações empurra o 'correct' para o fim.
    const pending = buildPendingQuestion(
      QUESTION,
      new FakeRandomSource([0, 0, 0]),
    );
    expect(pending.options[pending.correctIndex]).toBe('4');
    expect(pending.options[pending.proximalIndex]).toBe('3');
    // Todas as 4 alternativas presentes, sem perda.
    expect([...pending.options].sort()).toEqual(['22', '3', '4', '5']);
  });

  it('correctIndex e proximalIndex são distintos e válidos', () => {
    const pending = buildPendingQuestion(
      QUESTION,
      new FakeRandomSource([1, 0, 0]),
    );
    expect(pending.correctIndex).not.toBe(pending.proximalIndex);
    expect(pending.options).toHaveLength(4);
    [pending.correctIndex, pending.proximalIndex].forEach((i) => {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(4);
    });
  });
});

describe('classifyAnswer', () => {
  const pending = buildPendingQuestion(
    QUESTION,
    new FakeRandomSource([3, 2, 1]),
  );
  // ordem: ['4'(correct,0), '3'(proximal,1), '5'(wrong,2), '22'(wrong,3)]

  it('índice do correct → none (acerto)', () => {
    expect(classifyAnswer(pending, 0)).toBe('none');
  });
  it('índice do proximal → proximal', () => {
    expect(classifyAnswer(pending, 1)).toBe('proximal');
  });
  it('qualquer outro índice → wrong (erro total)', () => {
    expect(classifyAnswer(pending, 2)).toBe('wrong');
    expect(classifyAnswer(pending, 3)).toBe('wrong');
  });
});

describe('toQuestionPrompt — projeção SEGURA (RF-16)', () => {
  const pending = buildPendingQuestion(
    QUESTION,
    new FakeRandomSource([0, 1, 0]),
  );

  it('expõe apenas questionId, statement e options', () => {
    const view = toQuestionPrompt(pending);
    expect(Object.keys(view).sort()).toEqual([
      'options',
      'questionId',
      'statement',
    ]);
    expect(view.options).toHaveLength(4);
  });

  it('NUNCA vaza correctIndex/proximalIndex no payload', () => {
    const payload = toQuestionPrompt(pending) as unknown as Record<
      string,
      unknown
    >;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('correctIndex');
    expect(serialized).not.toContain('proximalIndex');
    // Não há campo que revele qual alternativa é a correta.
    expect(payload).not.toHaveProperty('correctIndex');
    expect(payload).not.toHaveProperty('proximalIndex');
    expect(payload).not.toHaveProperty('correct');
  });
});
