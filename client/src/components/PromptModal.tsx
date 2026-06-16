import React, { useState, useEffect } from "react";

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  type?: "text" | "password";
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
      <div className="w-full max-w-sm rounded-2xl bg-[#2a2a2a] p-6 shadow-xl border border-white/10" dir="auto">
        <h3 className="mb-2 text-lg font-bold text-white">{title}</h3>
        {description && <p className="mb-4 text-sm text-gray-400">{description}</p>}
        <input
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="mb-6 w-full rounded-lg bg-black/40 border border-white/10 px-4 py-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onConfirm(value);
            }
          }}
        />
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => onConfirm(value)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
