/**
 * The purpose registry: well-known libraries mapped to what they are for.
 * It doubles as a generalization filter: only libraries listed here become
 * dependency facets, so an app's business deps never leak into a pattern.
 * A missing entry degrades to a prose note, never a wrong facet, which is why
 * small-and-growing is safe. Tool purposes (lint, format, typecheck, test)
 * are deliberately absent: the toolchain facet owns tool identity (ADR-0003)
 * and the dependencies facet mirrors its winners.
 */
export type Ecosystem =
  | "npm"
  | "pypi"
  | "cargo"
  | "go"
  | "rubygems"
  | "maven"
  | "composer"
  | "nuget";

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
  Ruby: "rubygems",
  Java: "maven",
  Kotlin: "maven",
  PHP: "composer",
  "C#": "nuget",
  "F#": "nuget",
};

/**
 * The manifest file that identifies each ecosystem. A .NET project file is
 * named after the project, so `{name}` stands for it; `isManifestName`
 * recognizes the real thing.
 */
export const MANIFEST_OF: Record<Ecosystem, string> = {
  npm: "package.json",
  pypi: "pyproject.toml",
  cargo: "Cargo.toml",
  go: "go.mod",
  rubygems: "Gemfile",
  maven: "pom.xml",
  composer: "composer.json",
  nuget: "{name}.csproj",
};

/** Gradle keeps the Maven ecosystem's manifest in its own files. */
export const GRADLE_FILES = [
  "build.gradle.kts",
  "build.gradle",
  "settings.gradle.kts",
  "settings.gradle",
];

const DOTNET_PROJECT = /\.(csproj|fsproj|vbproj|sln|slnx)$/i;

/** A root manifest by name: a project decision new and check never invent (ADR-0003). */
export function isManifestName(name: string): boolean {
  return (
    Object.values(MANIFEST_OF).includes(name) ||
    GRADLE_FILES.includes(name) ||
    DOTNET_PROJECT.test(name)
  );
}

/** Root files that imply an ecosystem when no sanctioned language does. */
const ECOSYSTEM_BY_ROOT_FILE: [string, Ecosystem][] = [
  ["package.json", "npm"],
  ["deno.json", "npm"],
  ["pyproject.toml", "pypi"],
  ["requirements.txt", "pypi"],
  ["setup.py", "pypi"],
  ["Cargo.toml", "cargo"],
  ["go.mod", "go"],
  ["Gemfile", "rubygems"],
  ["pom.xml", "maven"],
  ["build.gradle.kts", "maven"],
  ["build.gradle", "maven"],
  ["composer.json", "composer"],
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
  const byFile = ECOSYSTEM_BY_ROOT_FILE.find(([file]) => rootPaths.has(file))?.[1];
  if (byFile) return byFile;
  // A .NET solution or project file carries the project's own name.
  return [...rootPaths].some((file) => DOTNET_PROJECT.test(file)) ? "nuget" : undefined;
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
  rubygems: {
    faraday: "http-client",
    httparty: "http-client",
    rails: "web-framework",
    sinatra: "web-framework",
    hanami: "web-framework",
    roda: "web-framework",
    activerecord: "orm",
    sequel: "orm",
    rom: "orm",
    pg: "db-driver",
    mysql2: "db-driver",
    sqlite3: "db-driver",
    redis: "cache",
    sidekiq: "queue",
    good_job: "queue",
    "dry-validation": "validation",
    oj: "serialization",
    multi_json: "serialization",
    logger: "logging",
    lograge: "logging",
    thor: "cli",
    dotenv: "config",
    "dotenv-rails": "config",
    erb: "templating",
    slim: "templating",
    haml: "templating",
    jwt: "auth",
    devise: "auth",
    i18n: "i18n",
    redcarpet: "markdown",
    kramdown: "markdown",
    yard: "docs",
    webmock: "mock",
    vcr: "mock",
    factory_bot: "mock",
  },
  maven: {
    "com.squareup.okhttp3:okhttp": "http-client",
    "com.squareup.retrofit2:retrofit": "http-client",
    "io.ktor:ktor-client-core": "http-client",
    "org.springframework.boot:spring-boot-starter-web": "web-framework",
    "org.springframework.boot:spring-boot-starter-webflux": "web-framework",
    "io.quarkus:quarkus-resteasy": "web-framework",
    "io.micronaut:micronaut-http-server-netty": "web-framework",
    "io.ktor:ktor-server-core": "web-framework",
    "io.javalin:javalin": "web-framework",
    "org.hibernate.orm:hibernate-core": "orm",
    "org.hibernate:hibernate-core": "orm",
    "org.springframework.boot:spring-boot-starter-data-jpa": "orm",
    "org.jetbrains.exposed:exposed-core": "orm",
    "org.jooq:jooq": "orm",
    "org.postgresql:postgresql": "db-driver",
    "com.mysql:mysql-connector-j": "db-driver",
    "org.xerial:sqlite-jdbc": "db-driver",
    "org.flywaydb:flyway-core": "migration",
    "org.liquibase:liquibase-core": "migration",
    "redis.clients:jedis": "cache",
    "io.lettuce:lettuce-core": "cache",
    "org.apache.kafka:kafka-clients": "queue",
    "com.rabbitmq:amqp-client": "queue",
    "jakarta.validation:jakarta.validation-api": "validation",
    "org.hibernate.validator:hibernate-validator": "validation",
    "com.fasterxml.jackson.core:jackson-databind": "serialization",
    "com.google.code.gson:gson": "serialization",
    "com.squareup.moshi:moshi": "serialization",
    "org.jetbrains.kotlinx:kotlinx-serialization-json": "serialization",
    "org.slf4j:slf4j-api": "logging",
    "ch.qos.logback:logback-classic": "logging",
    "org.apache.logging.log4j:log4j-core": "logging",
    "info.picocli:picocli": "cli",
    "com.github.ajalt.clikt:clikt": "cli",
    "com.typesafe:config": "config",
    "io.github.cdimascio:dotenv-java": "config",
    "org.thymeleaf:thymeleaf": "templating",
    "org.freemarker:freemarker": "templating",
    "io.jsonwebtoken:jjwt-api": "auth",
    "com.auth0:java-jwt": "auth",
    "org.jetbrains.kotlinx:kotlinx-coroutines-core": "async-runtime",
    "org.mockito:mockito-core": "mock",
    "io.mockk:mockk": "mock",
    "com.github.tomakehurst:wiremock": "mock",
  },
  composer: {
    "guzzlehttp/guzzle": "http-client",
    "symfony/http-client": "http-client",
    "laravel/framework": "web-framework",
    "symfony/framework-bundle": "web-framework",
    "slim/slim": "web-framework",
    "cakephp/cakephp": "web-framework",
    "doctrine/orm": "orm",
    "illuminate/database": "orm",
    "cycle/orm": "orm",
    "doctrine/dbal": "db-driver",
    "doctrine/migrations": "migration",
    "predis/predis": "cache",
    "php-amqplib/php-amqplib": "queue",
    "respect/validation": "validation",
    "symfony/validator": "validation",
    "symfony/serializer": "serialization",
    "jms/serializer": "serialization",
    "monolog/monolog": "logging",
    "symfony/console": "cli",
    "vlucas/phpdotenv": "config",
    "symfony/dotenv": "config",
    "twig/twig": "templating",
    "league/plates": "templating",
    "firebase/php-jwt": "auth",
    "lcobucci/jwt": "auth",
    "nesbot/carbon": "datetime",
    "symfony/translation": "i18n",
    "league/commonmark": "markdown",
    "mockery/mockery": "mock",
    "fakerphp/faker": "mock",
  },
  nuget: {
    "microsoft.aspnetcore.app": "web-framework",
    "microsoft.aspnetcore.openapi": "web-framework",
    "microsoft.entityframeworkcore": "orm",
    dapper: "orm",
    npgsql: "db-driver",
    "microsoft.data.sqlclient": "db-driver",
    "microsoft.data.sqlite": "db-driver",
    "stackexchange.redis": "cache",
    masstransit: "queue",
    "rabbitmq.client": "queue",
    fluentvalidation: "validation",
    "newtonsoft.json": "serialization",
    "system.text.json": "serialization",
    serilog: "logging",
    nlog: "logging",
    "system.commandline": "cli",
    "spectre.console": "cli",
    "microsoft.extensions.configuration": "config",
    dotnetenv: "config",
    razorlight: "templating",
    "microsoft.aspnetcore.authentication.jwtbearer": "auth",
    "system.identitymodel.tokens.jwt": "auth",
    nodatime: "datetime",
    markdig: "markdown",
    moq: "mock",
    nsubstitute: "mock",
    bogus: "mock",
  },
};
