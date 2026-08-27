/**
 * The purpose registry: well-known libraries mapped to what they are for.
 * It doubles as a generalization filter: only libraries listed here become
 * dependency facets, so an app's business deps never leak into a pattern.
 * A missing entry degrades to a prose note, never a wrong facet, which is why
 * small-and-growing is safe. Tool purposes (lint, format, typecheck, test)
 * are deliberately absent: the toolchain facet owns tool identity (ADR-0003)
 * and the dependencies facet mirrors its winners.
 */
export type Ecosystem = "npm" | "pypi" | "cargo" | "go";

/** Which ecosystem a sanctioned language implies (extract and new share this). */
export const ECOSYSTEM_BY_LANGUAGE: Record<string, Ecosystem> = {
  TypeScript: "npm",
  JavaScript: "npm",
  Vue: "npm",
  Svelte: "npm",
  Astro: "npm",
  Python: "pypi",
  Rust: "cargo",
  Go: "go",
};

/** The manifest file that identifies each ecosystem. */
export const MANIFEST_OF: Record<Ecosystem, string> = {
  npm: "package.json",
  pypi: "pyproject.toml",
  cargo: "Cargo.toml",
  go: "go.mod",
};

/** Root files that imply an ecosystem when no sanctioned language does. */
const ECOSYSTEM_BY_ROOT_FILE: [string, Ecosystem][] = [
  ["package.json", "npm"],
  ["deno.json", "npm"],
  ["pyproject.toml", "pypi"],
  ["requirements.txt", "pypi"],
  ["setup.py", "pypi"],
  ["Cargo.toml", "cargo"],
  ["go.mod", "go"],
];

/**
 * One primary ecosystem, decided the same way everywhere: the top sanctioned
 * language wins, falling back to root manifest presence in a fixed order.
 * Extract and new share it so a scaffold can never resolve differently from
 * the pattern it was extracted into.
 */
export function ecosystemOf(programming: string[], rootPaths: Set<string>): Ecosystem | undefined {
  for (const language of programming) {
    const ecosystem = ECOSYSTEM_BY_LANGUAGE[language];
    if (ecosystem) return ecosystem;
  }
  return ECOSYSTEM_BY_ROOT_FILE.find(([file]) => rootPaths.has(file))?.[1];
}

/**
 * The ecosystem a *pattern* prescribes, the one place new and check derive
 * it, with the same root-file semantics extract feeds `ecosystemOf`, so a
 * scaffold can never resolve differently from the pattern it came from.
 */
export function ecosystemOfPattern(pattern: {
  languages?: { programming: string[] };
  layout: { path: string }[];
}): Ecosystem | undefined {
  const rootFiles = new Set(
    pattern.layout.map((entry) => entry.path).filter((p) => !p.includes("/") && !p.endsWith("/")),
  );
  return ecosystemOf(pattern.languages?.programming ?? [], rootFiles);
}

export const PURPOSES = [
  "http-client",
  "web-framework",
  "ui-framework",
  "state-management",
  "css",
  "orm",
  "db-driver",
  "migration",
  "cache",
  "queue",
  "validation",
  "serialization",
  "compression",
  "logging",
  "error-handling",
  "cli",
  "config",
  "templating",
  "auth",
  "datetime",
  "i18n",
  "markdown",
  "docs",
  "mock",
  "async-runtime",
] as const;

export type Purpose = (typeof PURPOSES)[number];

/** Purposes that belong in `dev` even when a manifest has no dev section (go). */
export const DEV_PURPOSES: ReadonlySet<Purpose> = new Set(["mock", "docs"]);

export const REGISTRY: Record<Ecosystem, Record<string, Purpose>> = {
  npm: {
    axios: "http-client",
    "node-fetch": "http-client",
    got: "http-client",
    ky: "http-client",
    undici: "http-client",
    express: "web-framework",
    fastify: "web-framework",
    koa: "web-framework",
    hono: "web-framework",
    next: "web-framework",
    nuxt: "web-framework",
    react: "ui-framework",
    vue: "ui-framework",
    svelte: "ui-framework",
    "solid-js": "ui-framework",
    zustand: "state-management",
    redux: "state-management",
    mobx: "state-management",
    pinia: "state-management",
    tailwindcss: "css",
    "styled-components": "css",
    sass: "css",
    prisma: "orm",
    "drizzle-orm": "orm",
    typeorm: "orm",
    sequelize: "orm",
    mongoose: "orm",
    pg: "db-driver",
    mysql2: "db-driver",
    "better-sqlite3": "db-driver",
    redis: "cache",
    ioredis: "cache",
    bullmq: "queue",
    zod: "validation",
    yup: "validation",
    joi: "validation",
    valibot: "validation",
    ajv: "validation",
    yaml: "serialization",
    protobufjs: "serialization",
    fflate: "compression",
    pako: "compression",
    winston: "logging",
    pino: "logging",
    commander: "cli",
    yargs: "cli",
    citty: "cli",
    dotenv: "config",
    ejs: "templating",
    handlebars: "templating",
    nunjucks: "templating",
    jsonwebtoken: "auth",
    passport: "auth",
    dayjs: "datetime",
    "date-fns": "datetime",
    luxon: "datetime",
    moment: "datetime",
    i18next: "i18n",
    marked: "markdown",
    "markdown-it": "markdown",
    msw: "mock",
    nock: "mock",
  },
  pypi: {
    httpx: "http-client",
    requests: "http-client",
    aiohttp: "http-client",
    fastapi: "web-framework",
    flask: "web-framework",
    django: "web-framework",
    starlette: "web-framework",
    litestar: "web-framework",
    sqlalchemy: "orm",
    peewee: "orm",
    "tortoise-orm": "orm",
    psycopg: "db-driver",
    psycopg2: "db-driver",
    "psycopg2-binary": "db-driver",
    asyncpg: "db-driver",
    pymysql: "db-driver",
    aiosqlite: "db-driver",
    redis: "cache",
    alembic: "migration",
    celery: "queue",
    rq: "queue",
    dramatiq: "queue",
    pydantic: "validation",
    marshmallow: "validation",
    "pydantic-settings": "config",
    "python-dotenv": "config",
    dynaconf: "config",
    orjson: "serialization",
    msgpack: "serialization",
    pyyaml: "serialization",
    loguru: "logging",
    structlog: "logging",
    click: "cli",
    typer: "cli",
    rich: "cli",
    jinja2: "templating",
    mako: "templating",
    pyjwt: "auth",
    authlib: "auth",
    passlib: "auth",
    pendulum: "datetime",
    arrow: "datetime",
    "python-dateutil": "datetime",
    mkdocs: "docs",
    sphinx: "docs",
    responses: "mock",
    respx: "mock",
    faker: "mock",
  },
  cargo: {
    reqwest: "http-client",
    hyper: "http-client",
    axum: "web-framework",
    "actix-web": "web-framework",
    rocket: "web-framework",
    warp: "web-framework",
    tokio: "async-runtime",
    "async-std": "async-runtime",
    serde: "serialization",
    serde_json: "serialization",
    toml: "serialization",
    bincode: "serialization",
    sqlx: "db-driver",
    diesel: "orm",
    "sea-orm": "orm",
    redis: "cache",
    tracing: "logging",
    log: "logging",
    env_logger: "logging",
    anyhow: "error-handling",
    thiserror: "error-handling",
    clap: "cli",
    config: "config",
    dotenvy: "config",
    tera: "templating",
    askama: "templating",
    jsonwebtoken: "auth",
    validator: "validation",
    chrono: "datetime",
    time: "datetime",
  },
  go: {
    "github.com/gin-gonic/gin": "web-framework",
    "github.com/labstack/echo": "web-framework",
    "github.com/gofiber/fiber": "web-framework",
    "github.com/gorilla/mux": "web-framework",
    "github.com/spf13/cobra": "cli",
    "github.com/urfave/cli": "cli",
    "github.com/spf13/viper": "config",
    "github.com/joho/godotenv": "config",
    "gorm.io/gorm": "orm",
    "github.com/jmoiron/sqlx": "db-driver",
    "github.com/jackc/pgx": "db-driver",
    "github.com/redis/go-redis": "cache",
    "go.uber.org/zap": "logging",
    "github.com/sirupsen/logrus": "logging",
    "github.com/rs/zerolog": "logging",
    "github.com/golang-jwt/jwt": "auth",
    "github.com/go-playground/validator": "validation",
    "google.golang.org/protobuf": "serialization",
    "github.com/stretchr/testify": "mock",
  },
};
