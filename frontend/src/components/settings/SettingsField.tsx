// ============================================================
// SettingsField — Generic field component for settings
// ============================================================

import React from "react";
import { SensitiveInput } from "./SensitiveInput";

export type FieldType = "text" | "number" | "select" | "toggle" | "password" | "textarea" | "array";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SettingsFieldProps {
  label: string;
  description?: string;
  type: FieldType;
  value: any;
  onChange: (value: any) => void;
  options?: SelectOption[];  // For select type
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
  className?: string;
}

export function SettingsField({
  label,
  description,
  type,
  value,
  onChange,
  options = [],
  placeholder,
  disabled = false,
  required = false,
  min,
  max,
  className = "",
}: SettingsFieldProps) {
  const renderInput = () => {
    switch (type) {
      case "password":
        return (
          <SensitiveInput
            value={value || ""}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
          />
        );

      case "toggle":
        return (
          <label className="oc-field-toggle">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
            />
            <span className="oc-field-toggle__slider" />
            <span className="oc-field-toggle__label">
              {value ? "An" : "Aus"}
            </span>
          </label>
        );

      case "select":
        return (
          <select
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="oc-field-select"
          >
            {!required && <option value="">— Auswählen —</option>}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case "number":
        return (
          <input
            type="number"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            placeholder={placeholder}
            disabled={disabled}
            min={min}
            max={max}
            className="oc-field-input oc-field-input--number"
          />
        );

      case "textarea":
        return (
          <textarea
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="oc-field-textarea"
            rows={4}
          />
        );

      case "array":
        // Simple comma-separated array editor
        const arrValue = Array.isArray(value) ? value.join(", ") : "";
        return (
          <input
            type="text"
            value={arrValue}
            onChange={(e) => {
              const arr = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              onChange(arr.length > 0 ? arr : []);
            }}
            placeholder={placeholder || "Komma-separiert"}
            disabled={disabled}
            className="oc-field-input"
          />
        );

      default: // text
        return (
          <input
            type="text"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className="oc-field-input"
          />
        );
    }
  };

  return (
    <div className={`oc-field ${className}`}>
      <div className="oc-field__header">
        <label className="oc-field__label">
          {label}
          {required && <span className="oc-field__required">*</span>}
        </label>
      </div>
      <div className="oc-field__control">
        {renderInput()}
      </div>
      {description && (
        <p className="oc-field__desc">{description}</p>
      )}
    </div>
  );
}
