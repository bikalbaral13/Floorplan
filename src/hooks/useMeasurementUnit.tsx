"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type LinearUnit = "ft" | "ft-in" | "in" | "m" | "cm" | "mm";

interface MeasurementUnitContextValue {
  unit: LinearUnit;
  setUnit: (unit: LinearUnit) => void;
  // Base scale: pixels per foot is used internally in annotator; we expose helpers
  toFeet: (value: number, unit: LinearUnit) => number;
  fromFeet: (feet: number, unit: LinearUnit) => number;
  // Formatting helpers
  formatDistance: (feet: number) => string;
  formatArea: (squareFeet: number) => string;
}

const MeasurementUnitContext = createContext<MeasurementUnitContextValue | null>(null);

const STORAGE_KEY = "rdash.measurement.unit";

export function MeasurementUnitProvider({ children }: { children: ReactNode }) {
  const [unit, setUnitState] = useState<LinearUnit>("ft-in");

  /* Removed localStorage sync to rely on API data */

  const setUnit = (next: LinearUnit) => {
    setUnitState(next);  
  };

  const toFeet = (value: number, u: LinearUnit): number => {
    switch (u) {
      case "ft":
      case "ft-in":
        return value;
        // value in inches when using ft-in parsing pieces; callers convert before
      case "in":
        return value / 12;
      case "m":
        return value * 3.280839895; // meters to feet
      case "cm":
        return (value / 100) * 3.280839895;
      case "mm":
        return (value / 1000) * 3.280839895;
      default:
        return value;
    }
  };

  const fromFeet = (feet: number, u: LinearUnit): number => {
    switch (u) {
      case "ft":
      case "ft-in":
        return feet;
      case "in":
        return feet * 12;
      case "m":
        return feet / 3.280839895;
      case "cm":
        return (feet / 3.280839895) * 100;
      case "mm":
        return (feet / 3.280839895) * 1000;
      default:
        return feet;
    }
  };

  const formatFtIn = (feet: number): string => {
    const totalInches = Math.round(feet * 12);
    const wholeFeet = Math.floor(totalInches / 12);
    const remInches = totalInches % 12;
    return `${wholeFeet}' ${remInches}"`;
  };

  const formatDistance = (feet: number): string => {
    switch (unit) {
      case "ft":
        return `${feet.toFixed(2)} ft`;
      case "ft-in":
        return formatFtIn(feet);
      case "in":
        return `${(feet * 12).toFixed(2)} in`;
      case "m":
        return `${(feet / 3.280839895).toFixed(3)} m`;
      case "cm":
        return `${((feet / 3.280839895) * 100).toFixed(1)} cm`;
      case "mm":
        return `${((feet / 3.280839895) * 1000).toFixed(0)} mm`;
      default:
        return `${feet.toFixed(2)} ft`;
    }
  };

  const formatArea = (squareFeet: number): string => {
    switch (unit) {
      case "ft":
        return `${squareFeet.toFixed(2)} ft²`;
      case "ft-in":
        // Show in ft²; ft-in is awkward squared; prefer ft²
        return `${squareFeet.toFixed(2)} ft²`;
      case "in": {
        const sqIn = squareFeet * 144; // 12*12
        return `${sqIn.toFixed(0)} in²`;
      }
      case "m": {
        const sqm = squareFeet * 0.09290304;
        return `${sqm.toFixed(3)} m²`;
      }
      case "cm": {
        const sqcm = squareFeet * 929.0304;
        return `${sqcm.toFixed(0)} cm²`;
      }
      case "mm": {
        const sqmm = squareFeet * 92903.04;
        return `${sqmm.toFixed(0)} mm²`;
      }
      default:
        return `${squareFeet.toFixed(2)} ft²`;
    }
  };

  const value = useMemo<MeasurementUnitContextValue>(
    () => ({ unit, setUnit, toFeet, fromFeet, formatDistance, formatArea }),
    [unit]
  );

  return (
    <MeasurementUnitContext.Provider value={value}>
      {children}
    </MeasurementUnitContext.Provider>
  );
}

export function useMeasurementUnit(): MeasurementUnitContextValue {
  const ctx = useContext(MeasurementUnitContext);
  if (!ctx) throw new Error("useMeasurementUnit must be used within MeasurementUnitProvider");
  return ctx;
}



