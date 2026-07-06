import * as SelectPrimitive from "@radix-ui/react-select";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

export interface SelectFieldOption<Value extends string> {
  disabled?: boolean;
  label: string;
  value: Value;
}

export function SelectField<Value extends string>({
  ariaLabel,
  className,
  disabled = false,
  onValueChange,
  options,
  placeholder,
  value
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: Value) => void;
  options: Array<SelectFieldOption<Value>>;
  placeholder?: string;
  value: Value;
}) {
  return (
    <SelectPrimitive.Root
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as Value)}
    >
      <SelectPrimitive.Trigger aria-label={ariaLabel} className={clsx("ui-select-trigger", className)}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="ui-select-icon">
          <ChevronDown size={14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="ui-select-content" collisionPadding={10} position="popper" sideOffset={6}>
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="ui-select-item"
                disabled={option.disabled}
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ui-select-item-indicator">
                  <Check size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
