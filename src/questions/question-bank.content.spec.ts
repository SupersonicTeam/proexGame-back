// Content spec do banco REAL (/questions) — feature logica-programacao.
// Trava no CI as regras de conteúdo das 8 categorias de lógica de programação:
// volume por nível (PROG-02) e prefixo/unicidade de ids (PROG-03). O boot do
// serviço também valida schema, `code` e alternativas distintas (PROG-04/05).

import * as fs from 'fs';
import * as path from 'path';
import { RandomSource } from '../common/random/random.source';
import { QuestionDifficulty } from './question.types';
import { QuestionBankService } from './question-bank.service';

// Categoria (nome do arquivo / subject) → prefixo obrigatório do id.
const CATEGORY_PREFIX: Record<string, string> = {
  algoritmos: 'alg',
  'variaveis-e-tipos': 'var',
  condicionais: 'cond',
  'operadores-logicos': 'oplog',
  'lacos-de-repeticao': 'laco',
  vetores: 'vet',
  funcoes: 'func',
  'busca-e-ordenacao': 'bus',
};

const MIN_PER_LEVEL = 12;
const LEVELS: QuestionDifficulty[] = ['easy', 'normal', 'hard'];
const QUESTIONS_DIR = path.join(process.cwd(), 'questions');

const noRng: RandomSource = {
  int: () => 0,
  rollD6: () => 1,
};

describe('Banco real — categorias de lógica de programação', () => {
  let service: QuestionBankService;

  beforeAll(async () => {
    delete process.env.QUESTIONS_DIR;
    service = new QuestionBankService(noRng);
    await service.onModuleInit(); // falha aqui se o schema for violado
  });

  // Ids crus de todos os arquivos carregados (o serviço sobrescreveria
  // duplicatas em silêncio, então a unicidade é checada no JSON bruto).
  function rawIds(): string[] {
    return fs
      .readdirSync(QUESTIONS_DIR)
      .filter((f) => f.endsWith('.json'))
      .flatMap((f) =>
        (
          JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf-8')) as {
            id: string;
          }[]
        ).map((q) => q.id),
      );
  }

  it('ids são únicos em todo o banco', () => {
    const ids = rawIds();
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  const presentCategories = () =>
    service.subjects().filter((s) => s in CATEGORY_PREFIX);

  it('cada categoria presente tem ≥ 12 perguntas por nível', () => {
    for (const subject of presentCategories()) {
      for (const level of LEVELS) {
        const count = rawQuestions(subject).filter(
          (q) => q.difficulty === level,
        ).length;
        expect({ subject, level, ok: count >= MIN_PER_LEVEL }).toEqual({
          subject,
          level,
          ok: true,
        });
      }
    }
  });

  it('todo id de categoria segue <prefixo>-NNNN', () => {
    for (const subject of presentCategories()) {
      const re = new RegExp(`^${CATEGORY_PREFIX[subject]}-\\d{4}$`);
      const bad = rawQuestions(subject)
        .map((q) => q.id)
        .filter((id) => !re.test(id));
      expect({ subject, bad }).toEqual({ subject, bad: [] });
    }
  });

  function rawQuestions(
    subject: string,
  ): { id: string; difficulty: QuestionDifficulty }[] {
    return JSON.parse(
      fs.readFileSync(path.join(QUESTIONS_DIR, `${subject}.json`), 'utf-8'),
    ) as { id: string; difficulty: QuestionDifficulty }[];
  }
});

describe('Banco real — conjunto exato de matérias (PROG-01)', () => {
  it('carrega exatamente as 8 categorias de lógica de programação', async () => {
    delete process.env.QUESTIONS_DIR;
    const service = new QuestionBankService(noRng);
    await service.onModuleInit();
    expect(service.subjects()).toEqual(Object.keys(CATEGORY_PREFIX).sort());
  });

  it('as matérias escolares antigas ficam arquivadas, fora do carregamento', () => {
    const archived = fs
      .readdirSync(path.join(QUESTIONS_DIR, '_arquivo'))
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(archived).toEqual([
      'conhecimentos-gerais.json',
      'desenvolvimento-web.json',
      'fisica.json',
      'logica.json',
      'matematica-financeira.json',
      'matematica.json',
      'portugues.json',
      'quimica.json',
    ]);
  });
});
