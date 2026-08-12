import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const sql = read("07_session_functions.sql");
const sessionRoute = read("../app/api/rounds/[no]/session/route.ts");
const answerRoute = read("../app/api/rounds/[no]/answer/route.ts");
const nextRoute = read("../app/api/rounds/[no]/next/route.ts");
const resultRoute = read("../app/api/rounds/[no]/result/route.ts");
const cronRoute = read("../app/api/cron/expire-sessions/route.ts");
const quizLib = read("../lib/quiz.ts");

function has(source, pattern, message) {
  assert.match(source, pattern, message);
}

has(sql, /CREATE OR REPLACE FUNCTION public\.fn_create_quiz_session/, "원자 세션 생성 함수가 없습니다");
has(sql, /BEGIN;[\s\S]*COMMIT;/, "세션 함수 SQL이 트랜잭션으로 감싸져 있지 않습니다");
has(sql, /jsonb_array_length\(p_items\) <> 12/, "세션 문항 수 12개 검증이 없습니다");
has(sql, /INSERT INTO public\.quiz_session\s*\(/, "세션 INSERT가 없습니다");
has(sql, /INSERT INTO public\.quiz_session_item\s*\(/, "세션 문항 INSERT가 없습니다");
has(sql, /GET DIAGNOSTICS v_row_count = ROW_COUNT/, "문항 12행 생성 검증이 없습니다");
has(sql, /CREATE OR REPLACE FUNCTION public\.fn_reconcile_quiz_session/, "점수 재조정 함수가 없습니다");
has(sql, /FOR UPDATE/, "세션 행 잠금이 없습니다");
has(sql, /CREATE OR REPLACE FUNCTION public\.fn_expire_quiz_session/, "세션 만료 함수가 없습니다");
has(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC;/, "RPC 공개 실행 권한 회수가 없습니다");
has(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role;/, "서버 전용 RPC 실행 권한이 없습니다");

has(sessionRoute, /rpc\(\s*["']fn_create_quiz_session["']/, "세션 API가 원자 생성 RPC를 호출하지 않습니다");
has(sessionRoute, /p_items:\s*rows/, "세션 API가 셔플된 문항 배열을 전달하지 않습니다");
has(sessionRoute, /sessionFromRpc\(created\)/, "세션 RPC 결과 정규화가 없습니다");
assert.doesNotMatch(sessionRoute, /\.from\(["']quiz_session["']\)\s*\.insert/, "세션 API에 분리 INSERT가 남아 있습니다");
assert.doesNotMatch(sessionRoute, /\.from\(["']quiz_session_item["']\)\s*\.insert/, "세션 문항 분리 INSERT가 남아 있습니다");
assert.doesNotMatch(sessionRoute, /\.from\(["']quiz_session["']\)\s*\.delete/, "경합 정리를 위한 위험한 세션 삭제가 남아 있습니다");

has(answerRoute, /reconcileSession\(/, "답변 API가 점수 재조정 경로를 사용하지 않습니다");
assert.doesNotMatch(answerRoute, /async function finalizeSession/, "기존 비원자 finalizeSession이 남아 있습니다");
has(nextRoute, /reconcileSession\(session\.id,\s*true\)/, "마지막 문항 next 복구가 없습니다");
has(resultRoute, /expireIfIdle\(session\)/, "결과 조회 lazy 만료가 없습니다");
has(resultRoute, /reconcileSession\(session\.id,\s*false\)/, "결과 조회 점수 복구가 없습니다");
has(cronRoute, /fetchAll/, "만료 Cron 전량 페이지네이션이 없습니다");
has(cronRoute, /\.range\(from,\s*to\)/, "만료 Cron range 페이지가 없습니다");
has(quizLib, /rpc\("fn_reconcile_quiz_session"/, "공용 점수 재조정 RPC 래퍼가 없습니다");
has(quizLib, /rpc\("fn_expire_quiz_session"/, "공용 만료 RPC 래퍼가 없습니다");

console.log("세션 안정화 검증 통과: 원자 생성·점수 재조정·만료·대량 페이지네이션·결과 lazy 만료");
