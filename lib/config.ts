import { getDb } from "./db";

// 운영 파라미터는 app_config에서 읽는다. 하드코딩 금지 (CLAUDE.md 규칙 7).
// ★ min_rounds_for_ranking은 의도적으로 제외한다 (addendum C항).
//   그 값은 fn_min_rounds()의 입력일 뿐이며, 최소 회차가 필요한 곳은
//   항상 DB 함수 fn_min_rounds()를 호출해야 한다. 여기서 노출하면
//   캠페인 1·2주차에 화면 문구와 순위표가 모순된다.
const CONFIG_KEYS = [
  "item_time_limit_sec",
  "session_timeout_min",
  "items_per_round",
  "min_participants_for_dept",
  "min_participants_for_unit",
  "rank_visible_rows",
  "rank_max_rows",
  "login_max_attempts",
  "login_lock_minutes",
  "admin_max_attempts",
  "admin_lock_minutes",
  "point_base",
  "point_time_bonus_max",
] as const;

export type AppConfigKey = (typeof CONFIG_KEYS)[number];
export type AppConfig = Record<AppConfigKey, number>;

const CACHE_TTL_MS = 60_000;

let cache: { value: AppConfig; fetchedAt: number } | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value;
  }

  const { data, error } = await getDb()
    .from("app_config")
    .select("key, value")
    .in("key", [...CONFIG_KEYS]);
  if (error) {
    throw new Error(`app_config 조회 실패: ${error.message}`);
  }

  const value = Object.fromEntries(
    data.map((row) => [row.key, Number(row.value)])
  ) as AppConfig;

  const missing = CONFIG_KEYS.filter(
    (k) => !(k in value) || Number.isNaN(value[k])
  );
  if (missing.length > 0) {
    throw new Error(`app_config 값 누락: ${missing.join(", ")}`);
  }

  cache = { value, fetchedAt: Date.now() };
  return value;
}

export async function getConfigValue(key: AppConfigKey): Promise<number> {
  return (await getConfig())[key];
}
