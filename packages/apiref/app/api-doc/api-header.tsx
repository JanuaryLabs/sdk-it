import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '../shadcn/breadcrumb';

interface ApiHeaderProps {
  title: string;
}

export function ApiHeader({ title }: ApiHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b">
      <div className="flex items-center gap-2 px-3">
        <Breadcrumb>
          <BreadcrumbList>
            {/* <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="#">API Reference</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" /> */}
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  );
}
