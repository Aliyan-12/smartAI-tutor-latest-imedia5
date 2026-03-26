import { BookOpen, Calculator, Globe, Atom } from "lucide-react";

interface Props {
  onPromptClick: (text: string) => void;
}

const PROMPTS = [
  { icon: BookOpen, text: "Explain photosynthesis in simple terms", color: "#2d8a56" },
  { icon: Calculator, text: "Help me solve a quadratic equation", color: "#2563a8" },
  { icon: Globe, text: "What are the main causes of World War II?", color: "#c47a1a" },
  { icon: Atom, text: "Explain how fractions and decimals work", color: "#7044c4" },
];

export default function WelcomeScreen({ onPromptClick }: Props) {
  return (
    <div className="welcome-screen">
      <img src="/Original-Logo.png" alt="SmartAI Tutor" className="welcome-logo" />
      <h1>SmartAI Tutor</h1>
      <p>
        Your personal AI learning companion. Ask questions, get explanations,
        and master any subject at your own pace.
      </p>
      <div className="welcome-prompts">
        {PROMPTS.map((prompt) => (
          <button key={prompt.text} onClick={() => onPromptClick(prompt.text)}>
            <prompt.icon size={16} style={{ color: prompt.color, marginBottom: 6, display: "block" }} />
            {prompt.text}
          </button>
        ))}
      </div>
    </div>
  );
}
