import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "./ui/button";

type ToolButtonProps = {
    active?: boolean;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
};

export const ToolButton = ({
    active,
    icon,
    label,
    onClick,
    disabled,
}: ToolButtonProps) => {
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant={active ? "default" : "outline"}
                        size="sm"
                        onClick={onClick}
                        disabled={disabled}
                      
                    >
                        {icon}
                     
                    </Button>
                </TooltipTrigger>

                <TooltipContent side="right">
                    <p className="text-xs">{label}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};
