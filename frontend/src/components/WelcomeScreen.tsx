interface Props {
  onPromptClick: (text: string) => void;
}

const PROMPTS = [
  "Explain photosynthesis in simple terms",
  "Help me solve a quadratic equation",
  "What are the main causes of World War II?",
  "Explain how fractions and decimals work",
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
          <button key={prompt} onClick={() => onPromptClick(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
