'use client';

interface StepIndicatorProps {
  currentStep: number;
  steps: { label: string; description: string }[];
}

export function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 sm:gap-4">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;

        return (
          <div key={index} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  isCompleted
                    ? 'bg-accent-green text-white'
                    : isActive
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-muted'
                }`}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  stepNumber
                )}
              </div>
              <div className="hidden sm:block">
                <p
                  className={`text-sm font-medium ${
                    isActive ? 'text-text-primary' : 'text-text-muted'
                  }`}
                >
                  {step.label}
                </p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-8 sm:w-12 h-0.5 mx-2 ${
                  isCompleted ? 'bg-accent-green' : 'bg-bg-tertiary'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
