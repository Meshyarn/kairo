# Kairo 설치 + MCP 설정

npm 패키지로 Kairo를 설치하고 MCP 호스트에 연결하는 가이드입니다.

**소요 시간:** 8분 | **난이도:** 초급

---

## 1단계: Kairo 설치

### 옵션 A: npm 레지스트리에서

```bash
npm install kairo
```

다른 패키지 매니저 사용:

```bash
# yarn
yarn add kairo

# pnpm
pnpm add kairo

# bun
bun add kairo
```

### 옵션 B: 저장소에서 (개발용)

```bash
git clone https://github.com/anomalyco/kairo
cd kairo
npm ci
npm run build
```

빌드 완료 후 엔트리 포인트: `dist/index.js`

---

## 2단계: 설치 확인

### 빠른 테스트

```bash
# npm 스크립트로 설치한 경우:
npx kairo --help

# 저장소에서:
node dist/index.js --help
```

다음과 같이 출력되어야 합니다:

```
Options:
  --root <path>        Project root (default: cwd)
  --mode <mode>        mcp | server (default: mcp)
  --port <port>        Port (if mode=server)
```

### 스모크 테스트 (선택사항)

Kairo의 stdio 통신 확인:

```bash
# 저장소에서
npm run smoke:mcp-mock-client
```

종료 코드 0이면 정상입니다.

---

## 3단계: MCP 호스트 확인

Kairo는 **stdio** 기반 MCP 서버입니다. 호스트가 실행하고 JSON을 송수신합니다.

일반적인 호스트:

| 호스트 | 설정 파일 | 예시 |
|--------|----------|------|
| **Claude CLI** | `~/.claude/mcp_config.json` | 아래 참조 |
| **Cline (VS Code)** | `.cline/mcp_config.json` | 아래 참조 |
| **Cursor** | `.cursor/mcp_config.json` | 아래 참조 |
| **커스텀 에이전트** | 설정에 따라 | `command` + `args` + `env` 제공 |

---

## 4단계: 호스트에서 MCP 설정

### Claude CLI 예시

`~/.claude/mcp_config.json` 편집:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "node",
      "args": [
        "/absolute/path/to/kairo/dist/index.js",
        "--root",
        "/absolute/path/to/your/project"
      ],
      "timeout": 300000,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096",
        "KAIRO_MODE": "mcp",
        "KAIRO_PUBLIC_SURFACE": "compact",
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false",
        "KAIRO_MAX_RESULTS": "25"
      }
    }
  }
}
```

**주요 필드 설명:**

| 필드 | 설명 |
|------|------|
| `command` | Node.js 실행 파일 |
| `args[0]` | Kairo 엔트리 포인트 경로 |
| `args[1]`, `args[2]` | 항상 `--root`로 대상 프로젝트 지정 |
| `timeout` | 300초 (첫 실행 시 인덱싱 시간 포함. 필요시 조정) |
| `NODE_OPTIONS` | 힙 크기 (큰 저장소는 8192+ 권장) |
| `KAIRO_MODE` | MCP 호스트는 항상 `mcp` |
| `KAIRO_PUBLIC_SURFACE` | `compact` (권장) = `task` + `manage`; `pillars` = 원본 API |
| `KAIRO_LOG_TO_FILE` | stdout 깨끗하게 유지 (필수) |
| `KAIRO_ALLOW_STDOUT_LOGS` | `false` (파일에만 기록) |
| `KAIRO_MAX_RESULTS` | 결과 페이지 제한 (기본값 25 적절) |

### Cline (VS Code) 예시

프로젝트에 `.cline/mcp_config.json` 생성:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "node",
      "args": [
        "node_modules/kairo/dist/index.js",
        "--root",
        "."
      ],
      "timeout": 300000,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096",
        "KAIRO_MODE": "mcp",
        "KAIRO_PUBLIC_SURFACE": "compact",
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false"
      }
    }
  }
}
```

> **참고:** 프로젝트 로컬 설정 파일에는 상대 경로를 사용하는 것이 좋습니다.

### Cursor 예시

`.cursor/mcp_config.json` 생성:

```json
{
  "mcpServers": {
    "kairo": {
      "command": "node",
      "args": [
        "/absolute/path/to/kairo/dist/index.js",
        "--root",
        "/absolute/path/to/your/project"
      ],
      "timeout": 300000,
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=4096",
        "KAIRO_MODE": "mcp",
        "KAIRO_PUBLIC_SURFACE": "compact",
        "KAIRO_LOG_TO_FILE": "true",
        "KAIRO_ALLOW_STDOUT_LOGS": "false"
      }
    }
  }
}
```

---

## 5단계: 연결 테스트

### Claude CLI에서

```bash
claude
```

채팅에서:

```
What tools do I have available?
```

Claude가 `task`와 `manage` 도구를 나열하면 정상입니다.

### Cline에서

Cline이 활성화된 VS Code를 열고 코드 파일을 열면, Cline 채팅 패널에 사용 가능한 도구가 표시됩니다.

---

## 문제 해결

### "Kairo not found" 또는 명령을 찾을 수 없음

- 전역 설치: `npm install -g kairo` (권장하지 않음)
- 저장소에서: `dist/index.js`의 절대 경로 사용
- 확인: `node /path/to/kairo/dist/index.js --help`

### 첫 실행 시 타임아웃

- MCP 설정에서 `timeout`을 600000 (10분)으로 증가
- 첫 실행은 프로젝트 인덱싱; 이후는 훨씬 빠름
- 로그 확인: `tail -f .kairo/kairo.log`

### MCP 연결 실패 (조용히)

- `KAIRO_LOG_TO_FILE=true`와 `KAIRO_ALLOW_STDOUT_LOGS=false` 확인
- `.kairo/kairo.log` 에러 확인
- `--root`가 절대 경로인지 확인
- 루트 경로에 소스 코드나 설정 파일이 있는지 확인

### 호스트에서 "random parse errors"

- 원인: stdout에 로그 기록
- 해결: `KAIRO_LOG_TO_FILE=true`와 `KAIRO_ALLOW_STDOUT_LOGS=false`
- 호스트에서 MCP 연결 재시작

---

## 다음 단계

연결 후:

1. 첫 호출 실행: [첫 호출](/ko/quickstart/first-calls)
2. 프로젝트 초기화: [초기화 & 성능 튜닝](/ko/guides/initialization-and-performance-tuning)
3. 호스트 통합 모범 사례: [MCP 호스트 체크리스트](/ko/integrations/mcp-hosts)

---

## 참고

- [시작하기 (전체 가이드)](/ko/guides/getting-started)
- [MCP 호스트 통합](/ko/integrations/mcp-hosts)
- [설정 레퍼런스](/ko/reference/configuration/basics)
