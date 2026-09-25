import React, { useState, useEffect } from "react";

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password" | "select";
  options?: { value: string; label: string }[];
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  isOpen,
  title,
  description,
  placeholder,
  defaultValue = "",
  type = "text",
  confirmText = "Tamam",
  cancelText = "İptal",
  options,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) setValue(defaultValue);
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#1b1c16] p-6 shadow-2xl shadow-black/35 border border-emerald-300/15" dir="auto">
        <h3 className="mb-2 text-lg font-bold text-white">{title}</h3>
        {description && <p className="mb-4 text-sm text-gray-400">{description}</p>}
        
        {type === "select" && options ? (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mb-6 w-full rounded-lg bg-black/35 border border-white/10 px-4 py-3 text-white focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 transition-all"
            autoFocus
          >
            <option value="" disabled>{placeholder || "Seçiniz"}</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="mb-6 w-full rounded-lg bg-black/35 border border-white/10 px-4 py-3 text-white placeholder-gray-500 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 transition-all"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onConfirm(value);
              }
            }}
          />
        )}
        <div className="flex justify-end gap-3">
      </div>
    </div>
  );
}
