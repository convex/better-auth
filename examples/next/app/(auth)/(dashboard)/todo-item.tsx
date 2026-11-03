"use client";

import { Button } from "@/components/ui/button";
import { Check, Trash2, X } from "lucide-react";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { isPlaceholder } from "./mutations";

export const TodoItem = ({
  todo,
  onToggleCompleted,
  onRemove,
}: {
  todo: Doc<"todos">;
  onToggleCompleted: ({ id }: { id: Id<"todos"> }) => void;
  onRemove: ({ id }: { id: Id<"todos"> }) => void;
}) => {
  return (
    <li
      className="flex items-center gap-3 p-3 bg-neutral-900/50 border border-neutral-800 rounded-lg group hover:bg-neutral-900 transition-colors"
      key={todo._id}
    >
      <Button
        variant="ghost"
        size="icon"
        className="text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 cursor-pointer"
        disabled={isPlaceholder(todo._id)}
        onClick={() => onToggleCompleted({ id: todo._id })}
      >
        {todo.completed ? (
          <Check size={16} className="text-green-500" />
        ) : (
          <X size={16} />
        )}
      </Button>

      <span
        className={
          todo.completed
            ? "flex-1 line-through text-neutral-500"
            : "flex-1 text-neutral-100"
        }
      >
        {todo.text}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={isPlaceholder(todo._id)}
        onClick={() => onRemove({ id: todo._id })}
        className="text-neutral-500 hover:text-red-400 hover:bg-neutral-800 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      >
        <Trash2 size={16} />
      </Button>
    </li>
  );
};
