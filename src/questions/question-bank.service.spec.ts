// Testes do QuestionBankService (S2-02).
// Estratégia TDD: este arquivo é escrito ANTES da implementação.
// A maioria dos testes usa fixtures em memória via QUESTIONS_DIR para
// isolar do sistema de arquivos real em produção.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RandomSource } from '../common/random/random.source';
import { Question } from './question.types';
import { QuestionBankService } from './question-bank.service';

// Fonte de aleatoriedade determinística: consome valores de uma fila.
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

// Cria um diretório temporário com arquivos JSON de fixture e retorna o caminho.
function createTempDir(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbank-test-'));
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(dir, filename),
      JSON.stringify(content),
      'utf-8',
    );
  }
  return dir;
}

// Remove o diretório temporário após o teste.
function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Fixtures mínimas válidas para uso nos testes. Todas 'easy' por padrão para
// que os testes de pickQuestion que não exercitam o filtro de nível continuem
// vendo as 3 perguntas (o filtro por dificuldade é coberto em bloco próprio).
const VALID_MATEMATICA: Question[] = [
  {
    id: 'mat-0001',
    subject: 'matematica',
    difficulty: 'easy',
    statement: 'Quanto é 2 + 2?',
    correct: '4',
    proximal: '3',
    wrong: ['5', '6'],
  },
  {
    id: 'mat-0002',
    subject: 'matematica',
    difficulty: 'easy',
    statement: 'Quanto é 3 × 3?',
    correct: '9',
    proximal: '6',
    wrong: ['12', '8'],
  },
  {
    id: 'mat-0003',
    subject: 'matematica',
    difficulty: 'easy',
    statement: 'Qual é a raiz quadrada de 16?',
    correct: '4',
    proximal: '8',
    wrong: ['2', '6'],
  },
];

const VALID_PORTUGUES: Question[] = [
  {
    id: 'por-0001',
    subject: 'portugues',
    difficulty: 'easy',
    statement: 'Qual é o plural de "pão"?',
    correct: 'pães',
    proximal: 'pãos',
    wrong: ['pão', 'paes'],
  },
  {
    id: 'por-0002',
    subject: 'portugues',
    difficulty: 'easy',
    statement: 'O que é um substantivo?',
    correct: 'Palavra que nomeia seres, objetos e lugares',
    proximal: 'Palavra que expressa ação',
    wrong: ['Palavra que qualifica substantivos', 'Palavra de ligação'],
  },
  {
    id: 'por-0003',
    subject: 'portugues',
    difficulty: 'easy',
    statement: 'Qual é o antônimo de "feliz"?',
    correct: 'triste',
    proximal: 'infeliz',
    wrong: ['contente', 'alegre'],
  },
];

// Fixture com níveis mistos para exercitar o filtro de dificuldade.
const MIXED_MATEMATICA: Question[] = [
  {
    id: 'mat-e1',
    subject: 'matematica',
    difficulty: 'easy',
    statement: '2 + 2?',
    correct: '4',
    proximal: '3',
    wrong: ['5', '6'],
  },
  {
    id: 'mat-n1',
    subject: 'matematica',
    difficulty: 'normal',
    statement: '12 × 12?',
    correct: '144',
    proximal: '124',
    wrong: ['148', '120'],
  },
  {
    id: 'mat-h1',
    subject: 'matematica',
    difficulty: 'hard',
    statement: 'Derivada de x²?',
    correct: '2x',
    proximal: 'x',
    wrong: ['2', 'x²/2'],
  },
];

// Fábrica: cria serviço apontando para um dir temporário.
async function buildService(
  files: Record<string, unknown>,
  rng?: RandomSource,
): Promise<{ service: QuestionBankService; dir: string }> {
  const dir = createTempDir(files);
  const fakeRng = rng ?? new FakeRandomSource([0]);
  const service = new QuestionBankService(fakeRng);
  // Injeta o diretório via env (padrão do serviço: QUESTIONS_DIR ou cwd/questions).
  process.env.QUESTIONS_DIR = dir;
  await service.onModuleInit();
  return { service, dir };
}

describe('QuestionBankService — carga válida', () => {
  let dir: string;

  afterEach(() => {
    if (dir) removeTempDir(dir);
    delete process.env.QUESTIONS_DIR;
  });

  it('carrega todas as matérias presentes no diretório', async () => {
    const result = await buildService({
      'matematica.json': VALID_MATEMATICA,
      'portugues.json': VALID_PORTUGUES,
    });
    dir = result.dir;
    const subjects = result.service.subjects();
    expect(subjects).toEqual(
      expect.arrayContaining(['matematica', 'portugues']),
    );
    expect(subjects).toHaveLength(2);
  });

  it('retorna a pergunta correta por id', async () => {
    const result = await buildService({ 'matematica.json': VALID_MATEMATICA });
    dir = result.dir;
    const q = result.service.getById('mat-0001');
    expect(q).toBeDefined();
    expect(q!.id).toBe('mat-0001');
    expect(q!.subject).toBe('matematica');
  });

  it('retorna undefined para id inexistente', async () => {
    const result = await buildService({ 'matematica.json': VALID_MATEMATICA });
    dir = result.dir;
    expect(result.service.getById('nao-existe')).toBeUndefined();
  });
});

describe('QuestionBankService — schema inválido derruba o boot (fail-fast)', () => {
  let dir: string;

  afterEach(() => {
    if (dir) removeTempDir(dir);
    delete process.env.QUESTIONS_DIR;
  });

  it('lança erro quando campo obrigatório "id" está ausente', async () => {
    const invalid = [
      {
        subject: 'matematica',
        statement: 'x',
        correct: 'y',
        proximal: 'z',
        wrong: ['a', 'b'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando "wrong" tem menos de 2 elementos', async () => {
    const invalid = [
      {
        id: 'mat-0001',
        subject: 'matematica',
        statement: 'x',
        correct: 'y',
        proximal: 'z',
        wrong: ['a'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando "wrong" tem mais de 2 elementos', async () => {
    const invalid = [
      {
        id: 'mat-0001',
        subject: 'matematica',
        statement: 'x',
        correct: 'y',
        proximal: 'z',
        wrong: ['a', 'b', 'c'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando subject não bate com o nome do arquivo', async () => {
    const invalid = [
      {
        id: 'mat-0001',
        subject: 'historia',
        statement: 'x',
        correct: 'y',
        proximal: 'z',
        wrong: ['a', 'b'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando o JSON não é um array', async () => {
    dir = createTempDir({ 'matematica.json': { id: 'mat-0001' } });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando campo "statement" está ausente', async () => {
    const invalid = [
      {
        id: 'mat-0001',
        subject: 'matematica',
        correct: 'y',
        proximal: 'z',
        wrong: ['a', 'b'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando campo "difficulty" está ausente (RF-NEW-03)', async () => {
    const invalid = [
      {
        id: 'mat-0001',
        subject: 'matematica',
        statement: 'x',
        correct: 'y',
        proximal: 'z',
        wrong: ['a', 'b'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });

  it('lança erro quando "difficulty" tem valor inválido', async () => {
    const invalid = [
      {
        id: 'mat-0001',
        subject: 'matematica',
        difficulty: 'impossivel',
        statement: 'x',
        correct: 'y',
        proximal: 'z',
        wrong: ['a', 'b'],
      },
    ];
    dir = createTempDir({ 'matematica.json': invalid });
    const service = new QuestionBankService(new FakeRandomSource([0]));
    process.env.QUESTIONS_DIR = dir;
    await expect(service.onModuleInit()).rejects.toThrow();
  });
});

describe('QuestionBankService — pickQuestion', () => {
  let dir: string;

  afterEach(() => {
    if (dir) removeTempDir(dir);
    delete process.env.QUESTIONS_DIR;
  });

  it('retorna uma pergunta da matéria com excludedIds vazio', async () => {
    const rng = new FakeRandomSource([0]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion(
      'matematica',
      new Set<string>(),
      rng,
      'easy',
    );
    expect(q).not.toBeNull();
    expect(q!.subject).toBe('matematica');
  });

  it('nunca retorna pergunta cujo id está em excludedIds', async () => {
    // RNG retorna 0 repetidamente, mas mat-0001 está excluído —
    // deve sortear entre os candidatos restantes.
    const rng = new FakeRandomSource([0, 0, 0, 0]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const excluded = new Set(['mat-0001']);
    const q = result.service.pickQuestion('matematica', excluded, rng, 'easy');
    expect(q).not.toBeNull();
    expect(q!.id).not.toBe('mat-0001');
  });

  it('retorna null quando todas as perguntas da matéria estão excluídas', async () => {
    const rng = new FakeRandomSource([]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const excluded = new Set(['mat-0001', 'mat-0002', 'mat-0003']);
    const q = result.service.pickQuestion('matematica', excluded, rng, 'easy');
    expect(q).toBeNull();
  });

  it('retorna null para matéria inexistente', async () => {
    const rng = new FakeRandomSource([]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion(
      'historia',
      new Set<string>(),
      rng,
      'easy',
    );
    expect(q).toBeNull();
  });

  it('usa o rng injetado de forma determinística', async () => {
    // Com 3 perguntas disponíveis e rng retornando 2, deve escolher o índice 2 (mat-0003).
    const deterministicRng = new FakeRandomSource([2]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      deterministicRng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion(
      'matematica',
      new Set<string>(),
      deterministicRng,
      'easy',
    );
    expect(q).not.toBeNull();
    expect(q!.id).toBe('mat-0003');
  });

  it('usa o rng determinístico para sortear o primeiro índice (índice 0)', async () => {
    const deterministicRng = new FakeRandomSource([0]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      deterministicRng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion(
      'matematica',
      new Set<string>(),
      deterministicRng,
      'easy',
    );
    expect(q).not.toBeNull();
    expect(q!.id).toBe('mat-0001');
  });

  it('retorna a única pergunta disponível quando as outras estão excluídas', async () => {
    const rng = new FakeRandomSource([0]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const excluded = new Set(['mat-0001', 'mat-0002']);
    const q = result.service.pickQuestion('matematica', excluded, rng, 'easy');
    expect(q).not.toBeNull();
    expect(q!.id).toBe('mat-0003');
  });
});

describe('QuestionBankService — pickQuestion filtra por dificuldade (RF-NEW-04)', () => {
  let dir: string;

  afterEach(() => {
    if (dir) removeTempDir(dir);
    delete process.env.QUESTIONS_DIR;
  });

  it('só retorna pergunta do nível solicitado', async () => {
    // Banco misto (1 easy, 1 normal, 1 hard). Pedindo 'hard', só mat-h1 é
    // candidata — independentemente do índice do rng (pool de tamanho 1).
    const rng = new FakeRandomSource([0]);
    const result = await buildService(
      { 'matematica.json': MIXED_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion(
      'matematica',
      new Set<string>(),
      rng,
      'hard',
    );
    expect(q).not.toBeNull();
    expect(q!.id).toBe('mat-h1');
    expect(q!.difficulty).toBe('hard');
  });

  it('retorna null quando não há pergunta do nível (esgotamento → casa normal)', async () => {
    // Banco só tem easy/normal/hard com 1 cada; ao excluir a hard, pedir 'hard'
    // não acha nada → null (o serviço trata como casa normal, sem softlock).
    const rng = new FakeRandomSource([]);
    const result = await buildService(
      { 'matematica.json': MIXED_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion(
      'matematica',
      new Set(['mat-h1']),
      rng,
      'hard',
    );
    expect(q).toBeNull();
  });

  it('combina filtro de nível com excludedIds', async () => {
    // Dois 'normal': pedindo 'normal' e excluindo um, sobra o outro.
    const extra: Question[] = [
      ...MIXED_MATEMATICA,
      {
        id: 'mat-n2',
        subject: 'matematica',
        difficulty: 'normal',
        statement: '15 + 27?',
        correct: '42',
        proximal: '32',
        wrong: ['41', '52'],
      },
    ];
    const rng = new FakeRandomSource([0]);
    const result = await buildService({ 'matematica.json': extra }, rng);
    dir = result.dir;
    const q = result.service.pickQuestion(
      'matematica',
      new Set(['mat-n1']),
      rng,
      'normal',
    );
    expect(q).not.toBeNull();
    expect(q!.id).toBe('mat-n2');
  });
});
