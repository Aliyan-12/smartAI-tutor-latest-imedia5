import { BookOpen, Calculator, Globe, Atom } from "lucide-react";

interface Props {
  onPromptClick: (text: string) => void;
}

const PROMPTS = [
  { icon: BookOpen, text: "Explain photosynthesis in simple terms", color: "#30a46c" },
  { icon: Calculator, text: "Help me solve a quadratic equation", color: "#4f6df5" },
  { icon: Globe, text: "What are the main causes of World War II?", color: "#f5a623" },
  { icon: Atom, text: "Explain how fractions and decimals work", color: "#7c5cfc" },
];

export default function WelcomeScreen({ onPromptClick }: Props) {
  return (
    <div className="welcome-screen">
      <div className="icon">AI</div>
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
