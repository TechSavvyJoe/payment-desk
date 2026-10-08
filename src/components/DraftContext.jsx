import { createContext, useContext } from 'react';

export const DraftContext = createContext(null);
export function useInputDrafts() { return useContext(DraftContext); }
