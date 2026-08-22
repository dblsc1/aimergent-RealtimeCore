#!/usr/bin/env bash
# 审核检测脚本 · 消费方实际消费范围 vs module_docs 声明的一致性
#
# 为什么存在：contract.md「治理与变更控制」节的消费方清单被明确声明为
# 「供 CR 评审时评估影响面」——它如果漏掉某个 scope，未来动那个 scope 的 CR
# 就会被评为"不影响 copycat"。这是可机械核验的事实，按铁律17 必须脚本化。
#
# 做两件事：
#   A. 从消费方仓的**生产代码**（非测试文件）里机械提取实际 import 的
#      realtime_core scope 集合。
#   B. 拿这个集合去核 module_docs：①contract.md 消费方清单行是否逐个提到；
#      ②全 module_docs 里有没有"只消费 <单个 scope>"这类会与 A 矛盾的断言。
#
# 只读，不改任何文件。退出码 0 = 全部一致。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONSUMER_ROOT="${CONSUMER_ROOT:-/srv/aimergent/0/functions/copycat}"
CONSUMER_SRC="$CONSUMER_ROOT/code/backend/src"
PKG_SPEC="@aimergent/realtime-core"

fail=0
note() { printf '%s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }

[ -d "$CONSUMER_SRC" ] || { bad "消费方源码目录不存在：$CONSUMER_SRC"; exit 2; }

# ---- A. 生产代码实际消费的 scope ----------------------------------------
# 生产 = 非 *.test.mjs / *.test.js / *test-helpers*；且该行必须是真 import
# （静态 import ... from 或 动态 await import(...)），排除注释里提到包名的行。
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
command grep -rn "$PKG_SPEC/" --include='*.js' --include='*.mjs' "$CONSUMER_SRC" 2>/dev/null \
| command grep -v '/node_modules/' \
| while IFS= read -r line; do
    file="${line%%:*}"
    case "$file" in *.test.mjs|*.test.js|*test-helpers*) continue;; esac
    body="${line#*:}"; body="${body#*:}"
    case "${body# }" in '//'*|'*'*|'#'*) continue;; esac
    # 真 import：静态 import…from、动态 await import(…)，或多行 import 的续行 `} from '…'`
    case "$body" in *import*|*"from '"*|*'from "'*) ;; *) continue;; esac
    scope="${body#*$PKG_SPEC/}"
    scope="${scope%%/*}"
    scope="${scope%%\'*}"; scope="${scope%%\"*}"
    printf '%s\t%s\n' "$scope" "$file"
  done > "$tmp"

scopes="$(cut -f1 "$tmp" | sort -u)"
note "== A. 消费方生产代码实际 import 的 realtime_core scope =="
while IFS= read -r s; do
  [ -n "$s" ] || continue
  n=$(cut -f1 "$tmp" | command grep -cx "$s" || true)
  ex=$(command grep -P "^$s\t" "$tmp" 2>/dev/null | head -1 | cut -f2)
  note "  - $s/   (生产文件命中 $n 处，例：${ex#$CONSUMER_ROOT/})"
done <<< "$scopes"
note ""

# ---- B1. contract.md 消费方清单行是否覆盖每个 scope ----------------------
row="$(command grep -n '| `functions/copycat` |' "$REPO_ROOT/module_docs/contract.md" | head -1)"
if [ -z "$row" ]; then
  bad "contract.md 找不到 functions/copycat 的消费方清单行"
else
  note "== B1. contract.md 消费方清单行（L${row%%:*}）逐 scope 覆盖 =="
  while IFS= read -r s; do
    [ -n "$s" ] || continue
    if printf '%s' "$row" | command grep -q "\`$s/"; then
      pass "contract.md 消费方清单已登记 scope: $s/"
    else
      bad "contract.md 消费方清单**未登记**实际被生产代码消费的 scope: $s/ —— CR 影响面评估会漏掉它"
    fi
  done <<< "$scopes"
fi
note ""

# ---- B2. module_docs 里有没有"只消费 X"式的排他断言与 A 矛盾 -------------
note "== B2. module_docs 排他性断言（「只消费 …」）与实际 scope 集合的一致性 =="
hits="$(command grep -rn '只消费' "$REPO_ROOT/module_docs/" 2>/dev/null || true)"
if [ -z "$hits" ]; then
  pass "module_docs 无「只消费 …」排他断言"
else
  while IFS= read -r h; do
    [ -n "$h" ] || continue
    loc="${h%%:*}"; ln="${h#*:}"; ln="${ln%%:*}"
    claimed=""
    while IFS= read -r s; do
      [ -n "$s" ] || continue
      # 断言句里提到的 scope
      seg="${h#*只消费}"; seg="${seg:0:25}"
      printf '%s' "$seg" | command grep -q "\`$s/\?\`\|\`$s/" && claimed="$claimed $s"
    done <<< "$scopes"
    missing=""
    while IFS= read -r s; do
      [ -n "$s" ] || continue
      case " $claimed " in *" $s "*) ;; *) missing="$missing $s";; esac
    done <<< "$scopes"
    if [ -n "$missing" ]; then
      bad "$(basename "$loc"):$ln 断言「只消费${claimed:- ?}」，但生产代码还消费了:${missing}"
    else
      pass "$(basename "$loc"):$ln 的「只消费」断言与实际集合一致"
    fi
  done <<< "$hits"
fi

note ""
if [ "$fail" -eq 0 ]; then note "RESULT: PASS（消费范围声明与实际一致）"; else note "RESULT: FAIL（见上方 FAIL 行）"; fi
exit "$fail"
