// QuestionBankService — carrega o banco de perguntas em memória no boot (S2-02).
// Fonte: arquivos *.json em /questions/ (raiz do projeto) ou em QUESTIONS_DIR
// (variável de ambiente, usada principalmente em testes para isolamento).

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { Question, Subject } from './question.types';

@Injectable()
export class QuestionBankService implements OnModuleInit {
  // Mapa imutável após o boot: Subject → lista congelada de perguntas.
  private readonly bank = new Map<Subject, readonly Question[]>();

  // Índice auxiliar id → pergunta para O(1) em getById.
  private readonly byId = new Map<string, Question>();

  constructor(@Inject(RANDOM_SOURCE) private readonly rng: RandomSource) {}

  // Carrega e valida todos os *.json do diretório de perguntas.
  // Falha com erro explícito se qualquer item violar o schema (fail-fast).
  async onModuleInit(): Promise<void> {
    const dir = this.resolveQuestionsDir();
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    if (entries.length === 0) {
      throw new Error(
        `[QuestionBankService] Nenhum arquivo *.json encontrado em "${dir}".`,
      );
    }

    for (const filename of entries) {
      const subject = path.basename(filename, '.json') as Subject;
      const filepath = path.join(dir, filename);
      const raw = fs.readFileSync(filepath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const questions = this.validateFile(parsed, subject, filepath);

      // Congela cada item para impedir mutação acidental.
      const frozen = Object.freeze(
        questions.map((q) => Object.freeze({ ...q })),
      );
      this.bank.set(subject, frozen);
      for (const q of frozen) {
        this.byId.set(q.id, q);
      }
    }
  }

  // Retorna a lista de matérias carregadas.
  subjects(): Subject[] {
    return Array.from(this.bank.keys());
  }

  // Sorteia uma pergunta da matéria que NÃO esteja em excludedIds.
  // Usa `rng` para determinismo em testes. Retorna null se a matéria não
  // existe ou todas as perguntas foram servidas.
  pickQuestion(
    subject: Subject,
    excludedIds: Set<string>,
    rng: RandomSource,
  ): Question | null {
    const pool = this.bank.get(subject);
    if (!pool) return null;

    const available = pool.filter((q) => !excludedIds.has(q.id));
    if (available.length === 0) return null;

    const index = rng.int(0, available.length - 1);
    return available[index];
  }

  // Retorna a pergunta pelo id ou undefined se não existir.
  // Nota: retorna a instância congelada — uso interno do servidor apenas.
  getById(id: string): Question | undefined {
    return this.byId.get(id);
  }

  // Resolve o diretório de perguntas: QUESTIONS_DIR env tem prioridade;
  // fallback = <cwd>/questions (estrutura real do repositório).
  private resolveQuestionsDir(): string {
    return process.env.QUESTIONS_DIR ?? path.join(process.cwd(), 'questions');
  }

  // Valida o array de perguntas de um arquivo e retorna a lista tipada.
  // Lança Error descritivo em qualquer violação de schema.
  private validateFile(
    parsed: unknown,
    subject: Subject,
    filepath: string,
  ): Question[] {
    if (!Array.isArray(parsed)) {
      throw new Error(
        `[QuestionBankService] "${filepath}": esperado um array JSON no topo do arquivo, ` +
          `recebido ${typeof parsed}.`,
      );
    }

    return parsed.map((item: unknown, idx: number) => {
      const prefix = `[QuestionBankService] "${filepath}"[${idx}]`;

      if (typeof item !== 'object' || item === null) {
        throw new Error(`${prefix}: item deve ser um objeto.`);
      }

      const obj = item as Record<string, unknown>;

      // Valida campos obrigatórios de string simples.
      for (const field of [
        'id',
        'subject',
        'statement',
        'correct',
        'proximal',
      ] as const) {
        if (
          typeof obj[field] !== 'string' ||
          (obj[field] as string).trim() === ''
        ) {
          throw new Error(
            `${prefix}: campo "${field}" obrigatório está ausente ou não é uma string não-vazia.`,
          );
        }
      }

      // Valida que subject bate com o nome do arquivo.
      if (obj['subject'] !== subject) {
        throw new Error(
          `${prefix}: campo "subject" ("${obj['subject']}") não corresponde ao nome do arquivo ("${subject}").`,
        );
      }

      // Valida campo "wrong": array com exatamente 2 strings.
      if (!Array.isArray(obj['wrong']) || obj['wrong'].length !== 2) {
        throw new Error(
          `${prefix}: campo "wrong" deve ser um array com exatamente 2 strings ` +
            `(encontrado: ${JSON.stringify(obj['wrong'])}).`,
        );
      }
      for (const w of obj['wrong'] as unknown[]) {
        if (typeof w !== 'string') {
          throw new Error(
            `${prefix}: todos os elementos de "wrong" devem ser strings.`,
          );
        }
      }

      return {
        id: obj['id'] as string,
        subject: obj['subject'] as Subject,
        statement: obj['statement'] as string,
        correct: obj['correct'] as string,
        proximal: obj['proximal'] as string,
        wrong: obj['wrong'] as [string, string],
      };
    });
  }
}
