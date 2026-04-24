import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface ScaleDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (data: { unit: "ft-in" | "m"; feet: number; inches: number; meters: number }) => void;
    onCancel: () => void;
}

export const ScaleDialog: React.FC<ScaleDialogProps> = ({
    open,
    onOpenChange,
    onConfirm,
    onCancel,
}) => {
    const [scaleUnitForInput, setScaleUnitForInput] = useState<"ft-in" | "m">("ft-in");
    const [scaleFeetValue, setScaleFeetValue] = useState("");
    const [scaleInchValue, setScaleInchValue] = useState("");
    const [scaleInputValue, setScaleInputValue] = useState("");

    const handleConfirm = () => {
        let feet = 0;
        let inches = 0;
        let meters = 0;

        if (scaleUnitForInput === "ft-in") {
            feet = parseFloat(scaleFeetValue) || 0;
            inches = Math.round(parseFloat(scaleInchValue) || 0);

            if (feet === 0 && inches === 0) {
                toast.info("Please enter at least feet or inches value.");
                return;
            }
        } else {
            meters = parseFloat(scaleInputValue);
            if (!meters || meters <= 0) {
                toast.info("Please enter a valid meter value.");
                return;
            }
        }

        onConfirm({
            unit: scaleUnitForInput,
            feet,
            inches,
            meters
        });

        // Reset fields
        setScaleFeetValue("");
        setScaleInchValue("");
        setScaleInputValue("");
        setScaleUnitForInput("ft-in");
    };

    const handleCancel = () => {
        onCancel();
        // Reset fields
        setScaleFeetValue("");
        setScaleInchValue("");
        setScaleInputValue("");
        setScaleUnitForInput("ft-in");
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <div className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Set Scale</h3>
                    </div>
                    <div>
                        <label className="text-sm font-medium mb-2 block">Select Unit</label>
                        <div className="flex gap-2 mb-4">
                            <Button
                                variant={scaleUnitForInput === "ft-in" ? "default" : "outline"}
                                onClick={() => setScaleUnitForInput("ft-in")}
                                className="flex-1"
                            >
                                Feet-Inch
                            </Button>
                            <Button
                                variant={scaleUnitForInput === "m" ? "default" : "outline"}
                                onClick={() => setScaleUnitForInput("m")}
                                className="flex-1"
                            >
                                Meter
                            </Button>
                        </div>
                    </div>

                    {scaleUnitForInput === "ft-in" ? (
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Feet</label>
                                <Input
                                    type="number"
                                    value={scaleFeetValue}
                                    onChange={(e) => setScaleFeetValue(e.target.value)}
                                    placeholder="e.g., 12"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-2 block">Inches</label>
                                <Input
                                    type="number"
                                    value={scaleInchValue}
                                    onChange={(e) => setScaleInchValue(e.target.value)}
                                    placeholder="e.g., 6"
                                />
                            </div>
                        </div>
                    ) : (
                        <div>
                            <label className="text-sm font-medium mb-2 block">Meters</label>
                            <Input
                                type="number"
                                value={scaleInputValue}
                                onChange={(e) => setScaleInputValue(e.target.value)}
                                placeholder="e.g., 3.5"
                                autoFocus
                            />
                        </div>
                    )}
                    <div className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={handleCancel}>
                            Cancel
                        </Button>
                        <Button onClick={handleConfirm}>
                            Set Scale
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
