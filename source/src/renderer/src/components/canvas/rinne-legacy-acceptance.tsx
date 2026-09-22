import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface AcceptanceExpression {
  portraitSuffix: number;
  label: string;
  description: string;
}

interface ResolvedAcceptanceExpression extends AcceptanceExpression {
  portraitId: number;
}

interface RinneLegacyAcceptancePanelProps {
  ready: boolean;
  defaultPortraitId: number;
  outfitDisplayName: string;
  onSelectEmotion: (emotion: string) => Promise<number | null>;
  onSetMouthLevel: (level: number) => void;
  onSetSpeechDemo: (enabled: boolean) => void;
}

const EXPRESSIONS: readonly AcceptanceExpression[] = Object.freeze([
  { portraitSuffix: 1, label: "thinking", description: "思考" },
  { portraitSuffix: 2, label: "neutral", description: "中性" },
  { portraitSuffix: 3, label: "confused", description: "困惑" },
  { portraitSuffix: 4, label: "gentle", description: "温柔" },
  { portraitSuffix: 5, label: "awkward", description: "尴尬" },
  { portraitSuffix: 6, label: "happy", description: "开心" },
  { portraitSuffix: 7, label: "worried", description: "担心" },
  { portraitSuffix: 8, label: "surprised", description: "惊讶" },
  { portraitSuffix: 9, label: "dissatisfaction", description: "不满" },
  { portraitSuffix: 10, label: "flustered", description: "慌乱" },
  { portraitSuffix: 11, label: "sad", description: "悲伤" },
  { portraitSuffix: 12, label: "embarrassed", description: "难为情" },
  { portraitSuffix: 13, label: "shy", description: "害羞" },
  { portraitSuffix: 14, label: "uneasy", description: "不安" },
  { portraitSuffix: 15, label: "angry", description: "生气" },
]);

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function RinneLegacyAcceptancePanel({
  ready,
  defaultPortraitId,
  outfitDisplayName,
  onSelectEmotion,
  onSetMouthLevel,
  onSetSpeechDemo,
}: RinneLegacyAcceptancePanelProps) {
  const portraitFamily = defaultPortraitId - (defaultPortraitId % 100);
  const expressions = EXPRESSIONS.map((expression) => ({
    ...expression,
    portraitId: portraitFamily + expression.portraitSuffix,
  }));
  const shyPortraitId = portraitFamily + 13;
  const shyMouthPortraitId = portraitFamily + 4;
  const [selected, setSelected] = useState("neutral");
  const [status, setStatus] = useState("等待运行层初始化");
  const [cycling, setCycling] = useState(false);
  const [speechDemo, setSpeechDemo] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const cycleToken = useRef(0);

  useEffect(() => {
    if (ready) setStatus("运行层就绪；未连接后端或 TTS");
  }, [ready]);

  useEffect(
    () => () => {
      cycleToken.current += 1;
      try {
        onSetSpeechDemo(false);
      } catch {
        // The parent runtime may already be disposing after a fatal fallback.
      }
      window.api?.updateComponentHover?.("rinne-legacy-acceptance", false);
    },
    [onSetSpeechDemo],
  );

  const choose = useCallback(
    async (expression: ResolvedAcceptanceExpression) => {
      setStatus(`载入 MP${expression.portraitId} · ${expression.label}`);
      try {
        const portraitId = await onSelectEmotion(expression.label);
        if (portraitId !== expression.portraitId) {
          throw new Error(
            `${expression.label} 返回了意外的 MP${portraitId ?? "null"}`,
          );
        }
        setSelected(expression.label);
        setStatus(
          `已验证 MP${expression.portraitId} · ${expression.label}（${expression.description}）`,
        );
      } catch (error) {
        setStatus(`失败：${messageFrom(error)}`);
        throw error;
      }
    },
    [onSelectEmotion],
  );

  const cycleAll = async () => {
    const token = cycleToken.current + 1;
    cycleToken.current = token;
    setCycling(true);
    try {
      for (const expression of expressions) {
        if (cycleToken.current !== token) break;
        await choose(expression);
        await wait(850);
      }
      if (cycleToken.current === token) setStatus("15 个表情循环验证完成");
    } catch {
      // choose already reports the exact failure in the panel.
    } finally {
      if (cycleToken.current === token) setCycling(false);
    }
  };

  const toggleSpeechDemo = () => {
    const enabled = !speechDemo;
    try {
      onSetSpeechDemo(enabled);
      setSpeechDemo(enabled);
      setStatus(
        enabled
          ? "正在用离线音量序列循环驱动嘴型（没有音频或 TTS）"
          : "离线嘴型演示已停止",
      );
    } catch (error) {
      setStatus(`失败：${messageFrom(error)}`);
    }
  };

  const changeMouthLevel = (value: number) => {
    try {
      if (speechDemo) {
        onSetSpeechDemo(false);
        setSpeechDemo(false);
      }
      onSetMouthLevel(value);
      setMouthLevel(value);
      setStatus(`手动嘴型幅度 ${Math.round(value * 100)}%`);
    } catch (error) {
      setStatus(`失败：${messageFrom(error)}`);
    }
  };

  return createPortal(
    <section
      aria-label="凛祢离线验收面板"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        zIndex: 3000,
        width: 410,
        maxHeight: "calc(100vh - 40px)",
        overflowY: "auto",
        padding: 18,
        border: "1px solid rgba(255, 194, 220, 0.75)",
        borderRadius: 16,
        background: "rgba(28, 19, 31, 0.94)",
        color: "#fff7fb",
        boxShadow: "0 14px 38px rgba(0, 0, 0, 0.42)",
        pointerEvents: "auto",
        fontFamily: "system-ui, sans-serif",
      }}
      onPointerEnter={() =>
        window.api?.updateComponentHover?.("rinne-legacy-acceptance", true)
      }
      onPointerLeave={() =>
        window.api?.updateComponentHover?.("rinne-legacy-acceptance", false)
      }
    >
      <div style={{ fontSize: 18, fontWeight: 700 }}>
        {outfitDisplayName} · 桌宠离线验收
      </div>
      <p style={{ margin: "8px 0 14px", color: "#d9c6d3", lineHeight: 1.45 }}>
        真实 WebGL2 运行层；后端与 TTS 保持关闭，不发送聊天消息或写入聊天记录。
      </p>
      <button
        type="button"
        disabled={!ready || cycling}
        onClick={() => void cycleAll()}
        style={{
          width: "100%",
          padding: "10px 12px",
          marginBottom: 12,
          border: 0,
          borderRadius: 10,
          background: "#c94f88",
          color: "white",
          fontWeight: 700,
          cursor: ready && !cycling ? "pointer" : "not-allowed",
        }}
      >
        {cycling ? "正在循环 15 个表情…" : "依次循环全部 15 个表情"}
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 7,
        }}
      >
        {expressions.map((expression) => (
          <button
            key={expression.portraitId}
            type="button"
            disabled={!ready || cycling}
            aria-pressed={selected === expression.label}
            onClick={() => void choose(expression).catch(() => {})}
            style={{
              minHeight: 54,
              padding: "6px 4px",
              border: `1px solid ${
                selected === expression.label ? "#ff88bd" : "#624b5e"
              }`,
              borderRadius: 9,
              background: selected === expression.label ? "#6d3352" : "#302530",
              color: "#fff7fb",
              cursor: ready && !cycling ? "pointer" : "not-allowed",
              fontSize: 12,
              lineHeight: 1.25,
            }}
          >
            <span style={{ display: "block", fontWeight: 700 }}>
              {expression.label}
            </span>
            MP{expression.portraitId} · {expression.description}
          </button>
        ))}
      </div>
      <div
        style={{
          marginTop: 15,
          paddingTop: 13,
          borderTop: "1px solid #584654",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          正式 shy · MP{shyPortraitId} + MP{shyMouthPortraitId} gentle 嘴型
        </div>
        <p style={{ margin: 0, color: "#d9c6d3", lineHeight: 1.4 }}>
          点击上方 shy
          即可验收正式效果。身体、头发、眼睛、浓腮红、眨眼与呼吸来自 MP
          {shyPortraitId}，仅嘴部及连续语音嘴型来自 MP
          {shyMouthPortraitId}。
        </p>
      </div>
      <div
        style={{
          marginTop: 15,
          paddingTop: 13,
          borderTop: "1px solid #584654",
        }}
      >
        <button
          type="button"
          disabled={!ready}
          aria-pressed={speechDemo}
          onClick={toggleSpeechDemo}
          style={{
            width: "100%",
            padding: "9px 12px",
            border: "1px solid #875f78",
            borderRadius: 9,
            background: speechDemo ? "#844267" : "#302530",
            color: "#fff7fb",
            cursor: ready ? "pointer" : "not-allowed",
          }}
        >
          {speechDemo ? "停止离线连续嘴型" : "启动离线连续嘴型"}
        </button>
        <label style={{ display: "block", marginTop: 12 }}>
          手动嘴型幅度：{Math.round(mouthLevel * 100)}%
          <input
            aria-label="手动嘴型幅度"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={mouthLevel}
            disabled={!ready}
            onChange={(event) => changeMouthLevel(Number(event.target.value))}
            style={{ display: "block", width: "100%", marginTop: 7 }}
          />
        </label>
      </div>
      <output
        aria-live="polite"
        style={{
          display: "block",
          marginTop: 13,
          color: "#f4bed8",
          lineHeight: 1.4,
        }}
      >
        {status}
      </output>
    </section>,
    document.body,
  );
}
