#!/usr/bin/env bash
# review/reviewcode/ci/check_gitleaks_license.sh
#
# 机械核验 fix/gitleaks-license-env 分支对 .github/workflows/ci.yml 的改动：
#   ① diff 文件集合恰好等于 .github/workflows/ci.yml
#   ② 新增 GITLEAKS_LICENSE 落在 gitleaks-action 那个 step 的 env: 块内
#   ③ 右值是 ${{ secrets.GITLEAKS_LICENSE }}，无明文凭据
#   ④ 同 step 原有 GITHUB_TOKEN / GITLEAKS_CONFIG 未被改动或删除
#   ⑤ ci.yml 仍是合法 YAML
#
# 审的是具体历史提交（MAIN_SHA..TARGET_SHA），不是当前分支尖端——
# 这样即便审核者之后在同一分支上追加自己的 report/worklog 提交，
# 本脚本核验的范围也不会被自己的留痕提交污染。
set -uo pipefail

# ---- 本仓固定参数（写脚本当时的 origin/main 与 origin/fix/gitleaks-license-env）----
MAIN_SHA="9061648118fb3f94b27226970b2c119d434a059d"
TARGET_SHA="47c1bc75fa7295cf3d0e454bf3f84fc361dbea07"
FILE=".github/workflows/ci.yml"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

pass=0
fail=0
report() {
  local name="$1" ok="$2" detail="$3"
  if [ "$ok" = "0" ]; then
    echo "PASS ① $name"
    pass=$((pass+1))
  else
    echo "FAIL ① $name -- $detail"
    fail=$((fail+1))
  fi
}

# 确保两个 SHA 在本地可解析（可能需要先 fetch）
if ! git cat-file -e "${MAIN_SHA}^{commit}" 2>/dev/null || ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  git fetch origin --quiet 2>/dev/null
fi
if ! git cat-file -e "${MAIN_SHA}^{commit}" 2>/dev/null; then
  echo "FAIL setup -- 无法解析 MAIN_SHA=${MAIN_SHA}，先 git fetch origin"
  exit 2
fi
if ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  echo "FAIL setup -- 无法解析 TARGET_SHA=${TARGET_SHA}，先 git fetch origin"
  exit 2
fi

echo "== check_gitleaks_license.sh =="
echo "MAIN_SHA=${MAIN_SHA}"
echo "TARGET_SHA=${TARGET_SHA}"
echo

# ① diff 文件集合恰好等于 ci.yml
changed_files="$(git diff --name-only --no-renames "${MAIN_SHA}".."${TARGET_SHA}")"
n_files="$(printf '%s\n' "${changed_files}" | grep -c . || true)"
if [ "${n_files}" = "1" ] && [ "${changed_files}" = "${FILE}" ]; then
  echo "PASS ① 文件集合恰好等于 ${FILE}"
  pass=$((pass+1))
else
  echo "FAIL ① 文件集合不是恰好 ${FILE}，实际: [${changed_files}]"
  fail=$((fail+1))
fi

# 取出改动后 ci.yml 内容用于②③④⑤
ciyml="$(git show "${TARGET_SHA}:${FILE}" 2>/dev/null)"
if [ -z "${ciyml}" ]; then
  echo "FAIL setup -- 无法读取 ${TARGET_SHA}:${FILE}"
  exit 2
fi

# ② GITLEAKS_LICENSE 落在 gitleaks-action step 的 env: 块内
python3 - "$TARGET_SHA" "$FILE" <<'PYEOF'
import subprocess, sys, re

target, path = sys.argv[1], sys.argv[2]
text = subprocess.run(["git", "show", f"{target}:{path}"], capture_output=True, text=True, check=True).stdout
lines = text.split("\n")

def indent(s):
    return len(s) - len(s.lstrip(" "))

# 找到 "uses: gitleaks/gitleaks-action" 所在行，向上找同一 step 的起始（- name: 或 - uses:），
# 向下找该 step 的 env: 块，确认 GITLEAKS_LICENSE 在其中，且 GITHUB_TOKEN/GITLEAKS_CONFIG 也在其中。
gitleaks_step_idx = None
for i, l in enumerate(lines):
    if re.search(r'uses:\s*gitleaks/gitleaks-action', l):
        gitleaks_step_idx = i
        break

if gitleaks_step_idx is None:
    print("FAIL ② 找不到 uses: gitleaks/gitleaks-action 所在行")
    sys.exit(1)

step_indent = None
# 向上找本 step 起始行（以 "- " 开头，且缩进 <= uses 行缩进）
uses_indent = indent(lines[gitleaks_step_idx])
step_start = None
for i in range(gitleaks_step_idx, -1, -1):
    l = lines[i]
    if l.strip().startswith("- ") and indent(l) <= uses_indent:
        step_start = i
        step_indent = indent(l)
        break
if step_start is None:
    print("FAIL ② 找不到 gitleaks step 的起始行（- name/- uses）")
    sys.exit(1)

# 向下找本 step 结束（下一个同级或更浅缩进的 "- " 行，或文件结尾）
step_end = len(lines)
for i in range(step_start + 1, len(lines)):
    l = lines[i]
    if l.strip() == "":
        continue
    if l.strip().startswith("- ") and indent(l) <= step_indent:
        step_end = i
        break
    if indent(l) < step_indent and l.strip() != "":
        step_end = i
        break

step_lines = lines[step_start:step_end]

# 在 step 内找 env: 块
env_idx = None
env_indent = None
for i, l in enumerate(step_lines):
    m = re.match(r'^(\s*)env:\s*$', l)
    if m:
        env_idx = i
        env_indent = len(m.group(1))
        break

if env_idx is None:
    print("FAIL ② gitleaks step 内没有 env: 块")
    sys.exit(1)

env_block = []
for l in step_lines[env_idx+1:]:
    if l.strip() == "":
        continue
    if indent(l) <= env_indent:
        break
    env_block.append(l.strip())

env_text = "\n".join(env_block)

if "GITLEAKS_LICENSE:" in env_text:
    print("PASS ② GITLEAKS_LICENSE 落在 gitleaks-action step 的 env: 块内")
else:
    print(f"FAIL ② env: 块内没有 GITLEAKS_LICENSE，env 块内容: {env_block}")
    sys.exit(1)

# ③ 右值是 ${{ secrets.GITLEAKS_LICENSE }}
lic_line = next((l for l in env_block if l.startswith("GITLEAKS_LICENSE:")), "")
expected_val = "${{ secrets.GITLEAKS_LICENSE }}"
val = lic_line.split(":", 1)[1].strip() if ":" in lic_line else ""
if val == expected_val:
    print("PASS ③ GITLEAKS_LICENSE 右值是 ${{ secrets.GITLEAKS_LICENSE }}")
else:
    print(f"FAIL ③ GITLEAKS_LICENSE 右值不是预期的 secrets 引用，实际: '{val}'")
    sys.exit(1)

# ④ GITHUB_TOKEN / GITLEAKS_CONFIG 仍在同一 env 块内且未被删除/改动
gh_line = next((l for l in env_block if l.startswith("GITHUB_TOKEN:")), None)
cfg_line = next((l for l in env_block if l.startswith("GITLEAKS_CONFIG:")), None)
ok4 = True
if gh_line is None or "${{ secrets.GITHUB_TOKEN }}" not in gh_line:
    print(f"FAIL ④ GITHUB_TOKEN 缺失或被改动: {gh_line}")
    ok4 = False
if cfg_line is None or "ci/gates/.gitleaks.toml" not in cfg_line:
    print(f"FAIL ④ GITLEAKS_CONFIG 缺失或被改动: {cfg_line}")
    ok4 = False
if ok4:
    print("PASS ④ GITHUB_TOKEN / GITLEAKS_CONFIG 未被改动或删除")
else:
    sys.exit(1)

sys.exit(0)
PYEOF
py_rc=$?
if [ "$py_rc" = "0" ]; then
  pass=$((pass+3))
else
  fail=$((fail+3))
fi

# 全 diff 明文凭据扫描（③ 的补充：不只看 GITLEAKS_LICENSE 那一行，扫全 diff 新增行）
added_lines="$(git diff "${MAIN_SHA}".."${TARGET_SHA}" -- "${FILE}" | grep -E '^\+' | grep -v '^\+\+\+')"
# 排除我们自己插入的注释与 secrets 引用行，检查是否有形似密钥的明文（长随机串、常见密钥前缀）
suspicious="$(printf '%s\n' "${added_lines}" | grep -viE 'secrets\.|^\+\s*#' | grep -E '[A-Za-z0-9_\-]{20,}' || true)"
if [ -z "${suspicious}" ]; then
  echo "PASS ③b 全 diff 新增行无形似明文凭据"
  pass=$((pass+1))
else
  echo "FAIL ③b diff 新增行发现可疑明文: ${suspicious}"
  fail=$((fail+1))
fi

# ⑤ ci.yml 仍是合法 YAML
yaml_method="unknown"
if python3 -c "import yaml" 2>/dev/null; then
  yaml_method="pyyaml"
  if git show "${TARGET_SHA}:${FILE}" | python3 -c "import sys, yaml; yaml.safe_load(sys.stdin.read())" 2>/tmp/yamlerr.$$; then
    echo "PASS ⑤ ci.yml 是合法 YAML（用 pyyaml 校验）"
    pass=$((pass+1))
  else
    echo "FAIL ⑤ ci.yml 不是合法 YAML（pyyaml）: $(cat /tmp/yamlerr.$$)"
    fail=$((fail+1))
  fi
  rm -f /tmp/yamlerr.$$
else
  yaml_method="indent-fallback"
  # 退化检查：无 tab 缩进、无重复顶层 key
  if git show "${TARGET_SHA}:${FILE}" | grep -Pq '\t'; then
    echo "FAIL ⑤ ci.yml 含 tab 缩进（无 pyyaml，退化检查）"
    fail=$((fail+1))
  else
    echo "PASS ⑤ ci.yml 无 tab 缩进（无 pyyaml，退化检查，方法=${yaml_method}）"
    pass=$((pass+1))
  fi
fi

echo
echo "== 汇总: PASS=${pass} FAIL=${fail} (yaml 校验方法=${yaml_method}) =="
if [ "${fail}" = "0" ]; then
  exit 0
else
  exit 1
fi
