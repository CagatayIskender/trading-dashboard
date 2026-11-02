// Prints SQL that creates the demo account from DEFAULT_CONFIG.
import { DEFAULT_CONFIG } from "../engine/config.ts";
import { newPortfolio } from "../engine/portfolio.ts";

const state = newPortfolio(DEFAULT_CONFIG, "demo", Date.now());
const q = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
console.log(`insert into public.accounts (name, mode, config, state) values ('Demo', 'demo', ${q(DEFAULT_CONFIG)}, ${q(state)});`);
