import { db } from "./db";

export const TOKENS = {
  USDC: { address: "0x796Ea11Fa2dD751eD01b53C372fFDB4AAa8f00F9", decimals: 6 },
  WXTZ: { address: "0xc9B53AB2679f573e480d01e0f49e2B5CFB7a3EAb", decimals: 18 },
  WETH: { address: "0xfc24f770F94edBca6D6f885E12d4317320BcB401", decimals: 18 },
  USDT: { address: "0x2C03058C8AFC06713be23e58D2febC8337dbfE6A", decimals: 6 },
  WBTC: { address: "0xbFc94CD2B1E55999Cfc7347a9313e88702B83d0F", decimals: 8 },
  mTBILL: {
    address: "0xDD629E5241CbC5919847783e6C96B2De4754e438",
    decimals: 18,
  },
  mBASIS: {
    address: "0x2247B5A46BB79421a314aB0f0b67fFd11dd37Ee4",
    decimals: 18,
  },
  xU3O8: {
    address: "0x79052Ab3C166D4899a1e0DD033aC3b379AF0B1fD",
    decimals: 18,
  },
  USTBL: { address: "0xe4880249745eAc5F1eD9d8F7DF844792D560e750", decimals: 5 },
  EUTBL: { address: "0xa0769f7A8fC65e47dE93797b4e21C073c117Fc80", decimals: 5 },
  LBTC: { address: "0xecAc9C5F704e954931349Da37F60E39f515c11c1", decimals: 8 },
  stXTZ: { address: "0x01F07f4d78d47A64F4C3B2b65f513f15Be6E1854", decimals: 6 },
  mMEV: { address: "0x5542F82389b76C23f5848268893234d8A63fd5c8", decimals: 18 },
  mRE7: { address: "0x733d504435a49FC8C4e9759e756C2846c92f0160", decimals: 18 },
} as const;

export function upsertTokens(): void {
  const database = db();

  const upsertStmt = database.prepare(`
    INSERT OR REPLACE INTO tokens (symbol, address, decimals)
    VALUES (?, ?, ?)
  `);

  let completed = 0;
  const total = Object.keys(TOKENS).length;

  for (const [symbol, tokenData] of Object.entries(TOKENS)) {
    upsertStmt.run(
      [symbol, tokenData.address, tokenData.decimals],
      (err: Error | null) => {
        if (err) {
          console.error(`Error upserting token ${symbol}:`, err);
        }
        completed++;
        if (completed === total) {
          console.log("Tokens upserted successfully");
        }
      }
    );
  }
}
