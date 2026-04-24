import { AlertDialog, AlertDialogContent } from "@/components/ui/alert-dialog"; 
import { useEffect, useState } from "react";

export default function LoadingPopup({ show, progress }) {
  const [displayProgress, setDisplayProgress] = useState(progress);
  
  useEffect(() => {
    if (!show) {
      setDisplayProgress(0);
      return;
    }

    if (progress >= 100) {
      setDisplayProgress(100);
      return;
    }

    const increment = () => {
      setDisplayProgress(prev => {
        if (prev >= progress) return prev;
        const distance = progress - prev;
        const step = Math.max(0.5, distance / 20);
        const next = prev + step;
        return next >= progress ? progress : next;
      });
    };

    const interval = setInterval(increment, 100);
    return () => clearInterval(interval);
  }, [progress, show]);

  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (displayProgress / 100) * circumference;
  
  return (
    <AlertDialog open={show}>
      <AlertDialogContent className="max-w-md border-none bg-gradient-to-br from-[#114642] via-[#0e7068] to-[#062523] text-white shadow-2xl">
        <div className="flex flex-col items-center justify-center py-8 px-4">

          {/* Circle progress */}
          <div className="relative w-32 h-32 mb-6">
            {/* Outer glow */}
            <div className="absolute inset-0 rounded-full bg-[#4B9B94]/35 blur-xl animate-pulse"></div>
            
            <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 120 120">
              {/* Background track */}
              <circle
                cx="60"
                cy="60"
                r="54"
                stroke="currentColor"
                strokeWidth="8"
                fill="none"
                className="text-[#1a3f3c]"
              />

              {/* Teal progress circle */}
              <circle
                cx="60"
                cy="60"
                r="54"
  stroke="#d8eeec"
                strokeWidth="8"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-500 ease-out "
              />

              <defs>
                <linearGradient id="tealGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#4B9B94" />
                  <stop offset="100%" stopColor="#33716b" />
                </linearGradient>
              </defs>
            </svg>

            {/* Center value */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl font-bold bg-gradient-to-r from-[#85c5bf] to-[#d5e6e4] bg-clip-text text-transparent">
                {progress}%
              </span>
            </div>
          </div>

          {/* Processing dots */}
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-2xl font-semibold">Processing</h2>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-[#4B9B94] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1.5 h-1.5 bg-[#4B9B94] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1.5 h-1.5 bg-[#4B9B94] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>

          <p className="text-teal-200/70 text-sm">Please wait while we process your request...</p>

          {/* Bottom progress bar */}
          {/* <div className="w-full mt-6 h-1.5 bg-[#163a37] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#4B9B94] to-[#33716b] transition-all duration-500 ease-out shadow-[0_0_10px_#4B9B94]"
              style={{ width: `${progress}%` }}
            ></div>
          </div> */}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
