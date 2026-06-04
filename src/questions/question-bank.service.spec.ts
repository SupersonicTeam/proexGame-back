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

// Fixtures mínimas válidas para uso nos testes.
const VALID_MATEMATICA: Question[] = [
  {
    id: 'mat-0001',
    subject: 'matematica',
    statement: 'Quanto é 2 + 2?',
    correct: '4',
    proximal: '3',
    wrong: ['5', '6'],
  },
  {
    id: 'mat-0002',
    subject: 'matematica',
    statement: 'Quanto é 3 × 3?',
    correct: '9',
    proximal: '6',
    wrong: ['12', '8'],
  },
  {
    id: 'mat-0003',
    subject: 'matematica',
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
    statement: 'Qual é o plural de "pão"?',
    correct: 'pães',
    proximal: 'pãos',
    wrong: ['pão', 'paes'],
  },
  {
    id: 'por-0002',
    subject: 'portugues',
    statement: 'O que é um substantivo?',
    correct: 'Palavra que nomeia seres, objetos e lugares',
    proximal: 'Palavra que expressa ação',
    wrong: ['Palavra que qualifica substantivos', 'Palavra de ligação'],
  },
  {
    id: 'por-0003',
    subject: 'portugues',
    statement: 'Qual é o antônimo de "feliz"?',
    correct: 'triste',
    proximal: 'infeliz',
    wrong: ['contente', 'alegre'],
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
    const q = result.service.pickQuestion('matematica', new Set<string>(), rng);
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
    const q = result.service.pickQuestion('matematica', excluded, rng);
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
    const q = result.service.pickQuestion('matematica', excluded, rng);
    expect(q).toBeNull();
  });

  it('retorna null para matéria inexistente', async () => {
    const rng = new FakeRandomSource([]);
    const result = await buildService(
      { 'matematica.json': VALID_MATEMATICA },
      rng,
    );
    dir = result.dir;
    const q = result.service.pickQuestion('historia', new Set<string>(), rng);
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
    const q = result.service.pickQuestion('matematica', excluded, rng);
    expect(q).not.toBeNull();
    expect(q!.id).toBe('mat-0003');
  });
});
