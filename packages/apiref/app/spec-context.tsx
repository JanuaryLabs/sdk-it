import type { OpenAPIObject } from 'openapi3-ts/oas31';
import React, { type ReactNode, createContext, useContext } from 'react';

interface SpecContextType {
  spec: OpenAPIObject;
}

const SpecContext = createContext<SpecContextType | undefined>(undefined);

interface SpecProviderProps {
  spec: OpenAPIObject;
  children: ReactNode;
}

export const SpecProvider: React.FC<SpecProviderProps> = ({
  spec,
  children,
}) => {
  return (
    <SpecContext.Provider value={{ spec }}>{children}</SpecContext.Provider>
  );
};

export const useSpec = (): SpecContextType => {
  const context = useContext(SpecContext);

  if (context === undefined) {
    throw new Error('useSpec must be used within a SpecProvider');
  }

  return context;
};
