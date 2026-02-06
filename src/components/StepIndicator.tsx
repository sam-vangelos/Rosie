'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepIndicatorProps {
  currentStep: number;
  steps: { label: string; description: string }[];
  onStepClick?: (step: number) => void;
}

export function StepIndicator({ currentStep, steps, onStepClick }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 sm:gap-4">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;
        const isClickable = isCompleted && onStepClick;

        return (
          <div key={index} className="flex items-center">
            <button
              onClick={() => isClickable && onStepClick(stepNumber)}
              disabled={!isClickable}
              className={cn(
                'flex items-center gap-2',
                isClickable ? 'cursor-pointer group' : 'cursor-default',
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  isCompleted
                    ? 'bg-tier-top text-white group-hover:bg-tier-top/80'
                    : isActive
                    ? 'bg-chart-1 text-white'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className="size-4" /> : stepNumber}
              </div>
              <div className="hidden sm:block">
                <p
                  className={cn(
                    'text-sm font-medium transition-colors',
                    isActive
                      ? 'text-foreground'
                      : isCompleted
                      ? 'text-muted-foreground group-hover:text-foreground'
                      : 'text-muted-foreground/60',
                  )}
                >
                  {step.label}
                </p>
              </div>
            </button>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'w-8 sm:w-12 h-0.5 mx-2',
                  isCompleted ? 'bg-tier-top' : 'bg-muted',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
