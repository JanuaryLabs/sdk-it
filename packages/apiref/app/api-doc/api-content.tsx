import { ApiInfoSection } from './api-info';
import { OperationsList } from './operations-list';

export function ApiContent() {
  return (
    <div id="api-content" className="h-[calc(100vh-4rem)] overflow-y-auto">
      <ApiInfoSection />
      <OperationsList />
    </div>
  );
}
