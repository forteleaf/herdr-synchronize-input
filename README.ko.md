# herdr-synchronize-input — herdr 동기화 입력 플러그인

*[English](README.md) · 한국어*

## 개요

`herdr-synchronize-input`은 herdr 터미널 멀티플렉서용 플러그인으로, tmux의 `synchronize-panes`와 유사한 기능을 제공합니다. 사용자가 포커스된 패널(활성 패널)에 직접 타이핑하면, 같은 탭의 다른 모든 패널에 입력이 실시간으로 반영됩니다.

**작동 원리**: 플러그인이 포커스 패널의 화면 출력을 감시하여 입력 줄의 변화를 감지하고, `herdr pane send-text`로 다른 패널에 델타(변화분)를 전송합니다.

## 지원 버전

- herdr 0.7.4 이상
- **Node.js 런타임(PATH에 필요)** — herdr가 대신 설치해 주지 않습니다. 별도 빌드/컴파일 단계가 없고, npm 의존성도 없습니다.

> 플러그인 **id**는 `herdr-synchronize-input`입니다. (GitHub 저장소 이름과 동일하며, `herdr plugin config-dir` · 키바인딩 등에서 이 id를 사용합니다.)

## 설치

### 방법 A — GitHub에서 설치 (권장)

```bash
herdr plugin install forteleaf/herdr-synchronize-input
```

herdr가 저장소를 클론한 뒤 바로 등록합니다 — 빌드 단계가 없습니다. Node.js만 PATH에 있으면 됩니다.

### 방법 B — 로컬 체크아웃에서 링크 (개발용)

```bash
herdr plugin link "$(pwd)"     # 플러그인 디렉토리(herdr-plugin.toml이 있는 곳)에서
```

### 설정 파일 생성 (공통)

플러그인 설정 디렉토리에 config.toml을 복사합니다.

```bash
cp config.example.toml "$(herdr plugin config-dir herdr-synchronize-input)/config.toml"
```

이 명령으로 설정 파일의 위치를 확인할 수 있습니다:

```bash
herdr plugin config-dir herdr-synchronize-input
```

## 키바인딩 (수동 설정 필요)

herdr는 매니페스트로 키바인딩을 등록하는 방법을 제공하지 않으므로, 직접 추가해야 합니다. herdr 설정 파일(`~/.config/herdr/config.toml`)에 아래 블록을 추가합니다.

```toml
[[keys.command]]
key = "prefix+shift+y"
type = "plugin_action"
command = "herdr-synchronize-input.toggle"
description = "synchronize input to all panes"
```

`prefix`는 기본값이 `Ctrl-b`입니다(사용자가 지정한 herdr prefix). 따라서 `prefix Shift-y`를 누르면 동기화가 토글됩니다. 다른 단축키를 쓰려면 `key` 값을 바꾸세요.

블록을 추가한 뒤에는 **herdr를 재부착**해야 적용됩니다.

## 제어키 브로드캐스트 (Ctrl+L, Ctrl+C, …)

텍스트 동기화는 타이핑한 문자를 미러링하지만, 제어키(Ctrl+L·Ctrl+C·화살표 등)는 미러링할 수 없습니다 — 입력 줄에 흔적을 남기지 않고 herdr에 키 입력 훅도 없기 때문입니다. 이런 키를 위해 플러그인은 키에 바인딩하는 **브로드캐스트 액션**을 제공합니다:

| 액션 | 전송 키 |
|---|---|
| `herdr-synchronize-input.send-ctrl-l` | Ctrl+L (화면 clear) |
| `herdr-synchronize-input.send-ctrl-c` | Ctrl+C (중단) |
| `herdr-synchronize-input.send-ctrl-d` | Ctrl+D (EOF) |
| `herdr-synchronize-input.send-ctrl-w` | Ctrl+W (단어 삭제) |
| `herdr-synchronize-input.send-ctrl-b` | Ctrl+B (예: tmux prefix) |

각 액션은 **sync-aware**입니다: 동기화가 ON이면 포커스 탭의 모든 패널에(ignore 제외), OFF이면 포커스 패널에만 보냅니다 — 그래서 실제 키 위에 직접 바인딩해도 안전합니다.

원하는 것만 `~/.config/herdr/config.toml`에 바인딩하세요. 두 가지 방식:

```toml
# 전용 단축키(권장) — 실제 Ctrl+L은 그대로 둠:
[[keys.command]]
key = "prefix+ctrl+l"
type = "plugin_action"
command = "herdr-synchronize-input.send-ctrl-l"
description = "clear all panes"

# 또는 실제 키 위에 직접 바인딩(습관대로. 동기화 OFF면 포커스 패널로 그냥 전달):
[[keys.command]]
key = "ctrl+l"
type = "plugin_action"
command = "herdr-synchronize-input.send-ctrl-l"
description = "clear all panes when synced"
```

다른 키를 브로드캐스트하려면 `herdr-plugin.toml`의 액션을 복사하고 herdr 키 이름(예: `ctrl+a`, `up`)을 넣으면 됩니다. 단, 바인딩된 키는 누를 때마다 짧은 Node 프로세스를 하나 띄우므로, 아주 자주 누르는 키에 거는 것은 피하세요.

### 중첩 tmux 제어 (부분 지원)

패널들이 SSH로 서버에 접속해 tmux를 띄운 상태라면, `ctrl+b`를 `send-ctrl-b`에 바인딩해 tmux prefix를 모든 패널에 브로드캐스트할 수 있어 모든 세션이 동시에 prefix 모드로 들어갑니다. **하지만 prefix _다음_에 누르는 키**(tmux 명령 — `c`, `n`, 화살표 등)는 tmux가 가로채 셸에 에코되지 않으므로, 텍스트 감시가 보거나 브로드캐스트할 수 없습니다. 원격 tmux를 완전히 제어하려면 그 키들을 각각 브로드캐스트 액션으로 바인딩해야 합니다. 즉 prefix와 개별 제어키까지는 되지만, "prefix + 명령키" 시퀀스 전체 동기화는 안 됩니다.

## 사용법

### 동기화 활성화/비활성화

`prefix+shift+y` (예: `Ctrl-b Shift-y`)를 눌러 동기화를 토글합니다.

- **첫 번째 클릭**: 동기화 활성화 — 포커스 탭의 포커스 패널에 타이핑하면 다른 패널에도 반영됩니다.
- **두 번째 클릭**: 동기화 비활성화

### 입력 반영

동기화가 활성화된 상태에서:

1. 포커스 패널에서 텍스트를 입력합니다.
2. 입력된 각 문자가 같은 탭의 다른 패널에 실시간으로 전송됩니다.
3. `Enter`를 누르면 다른 패널에도 개행이 전송되어, 모든 패널에서 동시에 명령이 실행됩니다.
4. 백스페이스(`Backspace`)로 삭제한 문자도 반영됩니다(프롬프트 제거 후 계산).

## 설정

설정 파일(`$(herdr plugin config-dir herdr-synchronize-input)/config.toml`)의 필드:

### `ignore_panes`

동기화에서 제외할 패널 ID의 리스트입니다. 예: `["w0:p1", "w1:p3"]`

`herdr pane list` 명령으로 패널 ID를 확인할 수 있습니다.

```bash
herdr pane list
```

**기본값**: `[]` (모든 패널 포함)

**예**:
```toml
ignore_panes = ["w0:p1"]  # 워크스페이스 0, 패널 1은 제외
```

### `notify`

동기화가 활성화될 때 herdr 알림 표시 여부입니다. `true` 또는 `false`.

**기본값**: `true`

```toml
notify = true
```

### `poll_interval_ms`

화면 출력 감시 주기(밀리초)입니다. 값이 작을수록 반응성이 좋지만 CPU 사용률이 높아집니다.

**기본값**: `60` (0.06초)

**범위**: 권장 50~500ms

```toml
poll_interval_ms = 60
```

### `prompt_regex`

입력 줄에서 프롬프트를 제거하기 위한 정규표현식(선택 사항)입니다. 이 정규표현식이 매칭되는 부분(예: `user@host:~$`)은 입력 텍스트로 간주하지 않습니다.

프롬프트 제거가 제대로 작동하지 않으면 이 옵션을 설정하여 정확도를 높일 수 있습니다.

**기본값**: 미설정(정규표현식 사용 안 함, 기본 휴리스틱만 적용)

**예**:
```toml
# bash 스타일 프롬프트: "user@host:~$ "
prompt_regex = "^[^@]+@[^ ]+:[^$]*\\$ $"

# zsh 스타일 프롬프트: "user@host ~$ "
prompt_regex = "^[^@]+@[^ ]+.*\\$ $"

# 단순 $ 프롬프트
prompt_regex = "^\\$ $"
```

## 한계 및 제한사항

**중요**: 이 플러그인은 herdr 플러그인 API의 제약으로 인해 다음과 같은 한계가 있습니다.

### 원인

herdr 플러그인 API는 **키 입력 이벤트 훅을 제공하지 않습니다**. tmux의 경우 키 입력을 원천에서 복제할 수 있지만, herdr에서는 불가능합니다. 따라서 이 플러그인은 포커스 패널의 **화면 출력을 감시**하여 입력 줄의 변화를 감지하고 다른 패널에 흉내내는 방식으로 동작합니다.

### 동작하는 경우

- ✅ 일반 텍스트 입력 (영문, 한글, 기호)
- ✅ 백스페이스(`Backspace`)로 삭제
- ✅ `Enter`로 명령 실행

### 동작하지 않는 경우

- ❌ **특수 제어 키**: `Ctrl-C`, `Ctrl-D`, `Ctrl-Z`, 화살표 키(`←`, `→`, `↑`, `↓`), `Esc`, `Tab` 등. 이들 키는 다른 패널에 전송되지 않습니다.
- ❌ **비밀번호 입력**: 비밀번호는 일반적으로 에코되지 않으므로 감시 불가능합니다.
- ⚠️ **셸 자동완성 및 색상 강조**: `zsh`의 구문 강조는 동기화되지 않습니다. `bash`·`fish` 등의 자동완성은 잘못 미러링될 수 있습니다.
- ❌ **멀티라인 명령**: 여러 줄의 명령(예: 헤레독)에서 오정렬이 발생할 수 있습니다.
- ❌ **복잡한 셸 인터랙션**: 대화형 프로그램(`vim`, `less`, `python` REPL 등)은 지원하지 않습니다.

### 언제 사용하면 좋은가

- 여러 서버에 동일한 명령을 실행하고 싶을 때
- 동일한 파일 경로를 여러 패널에 입력하고 싶을 때
- 간단한 스크립트나 명령 라인 작업을 여러 패널에서 동시에 실행하고 싶을 때

### 언제 사용하면 안 되는가

- 정확한 입력 동기화가 필수적인 작업(예: 비밀번호, 민감한 설정)
- 대화형 프로그램 제어
- 복잡한 셸 자동완성 또는 구문 강조 기능이 필요한 경우

## 트러블슈팅

### 동기화가 작동하지 않음

**증상**: 입력했는데 다른 패널에 나타나지 않음

**해결 방법**:

1. 동기화가 활성화되었는지 확인합니다. `prefix+shift+y`를 누르면 herdr이 알림을 표시합니다 (`notify = true`일 때).

2. 키바인딩이 등록되었는지 확인합니다. [키바인딩 (수동 설정 필요)](#키바인딩-수동-설정-필요) 블록이 `~/.config/herdr/config.toml`에 있어야 하며, 추가 후 herdr 서버를 재부착해야 합니다.

3. 포커스 패널이 올바른지 확인합니다. 어두운 테두리로 표시된 패널이 포커스 패널입니다.

4. 다른 패널이 같은 탭에 있는지 확인합니다. 동기화는 같은 탭 내의 패널에만 적용됩니다.

5. 프롬프트가 올바르게 인식되는지 확인합니다:
   - 포커스 패널에 프롬프트만 표시된 상태에서 (아무 입력 없이) 한 글자를 입력합니다.
   - 그 글자가 다른 패널에 나타나지 않으면, 프롬프트 인식에 문제가 있을 수 있습니다.
   - 이 경우 `config.toml`의 `prompt_regex`를 설정하여 프롬프트를 명시적으로 정의합니다.

### 특정 패널을 제외하고 싶음

`config.toml`에서 `ignore_panes`를 설정합니다:

```toml
ignore_panes = ["w0:p2", "w0:p3"]
```

패널 ID는 `herdr pane list` 명령으로 확인합니다.

### CPU 사용률이 높음

감시 주기를 늘립니다. `config.toml`에서 `poll_interval_ms`를 증가시킵니다:

```toml
poll_interval_ms = 200  # 기본값 60에서 200으로 증가
```

반응성과 CPU 사용률의 트레이드오프를 고려하여 조정합니다.

## 참고

- `herdr pane list`: 워크스페이스의 모든 패널 목록 표시
- `herdr tab list`: 현재 워크스페이스의 탭 목록 표시
- `herdr pane read <id>`: 특정 패널의 화면 내용 읽기
- `herdr notification show <title>`: herdr 알림 표시

## 라이선스

(프로젝트 라이선스 정보)
