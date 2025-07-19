import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from './button';

export interface PaginationProps {
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  pageCount,
  onPageChange,
}: PaginationProps) {
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < pageCount - 1;

  // Convert 0-based index to 1-based for display
  const displayCurrentPage = currentPage + 1;

  const getPageNumbers = () => {
    const pages: number[] = [];
    const maxVisiblePages = 5;

    if (pageCount <= maxVisiblePages) {
      // Show all pages if total pages is less than max visible
      for (let i = 1; i <= pageCount; i++) {
        pages.push(i);
      }
    } else {
      // Show pages around current page
      let start = Math.max(1, displayCurrentPage - 2);
      let end = Math.min(pageCount, displayCurrentPage + 2);

      // Adjust if we're near the beginning or end
      if (displayCurrentPage <= 3) {
        end = Math.min(pageCount, 5);
      } else if (displayCurrentPage >= pageCount - 2) {
        start = Math.max(1, pageCount - 4);
      }

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex items-center justify-center space-x-1 py-4">
      {/* Previous Button */}
      <Button
        variant="outline"
        className="h-10 w-10 cursor-pointer rounded-lg border-gray-300 p-0 hover:bg-gray-50"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={!canGoPrevious}
      >
        <span className="sr-only">الصفحة السابقة</span>
        <ChevronRight className="h-4 w-4" />
      </Button>

      {/* Page Numbers */}
      {pageNumbers.map((pageNum) => (
        <Button
          key={pageNum}
          variant={pageNum === displayCurrentPage ? 'default' : 'outline'}
          className={`h-10 w-10 cursor-pointer rounded-lg p-0 ${
            pageNum === displayCurrentPage
              ? 'border-green-500 bg-green-500 text-white hover:bg-green-600'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
          onClick={() => onPageChange(pageNum - 1)}
        >
          {pageNum}
        </Button>
      ))}

      {/* Next Button */}
      <Button
        variant="outline"
        className="h-10 w-10 cursor-pointer rounded-lg border-gray-300 p-0 hover:bg-gray-50"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={!canGoNext}
      >
        <span className="sr-only">الصفحة التالية</span>
        <ChevronLeft className="h-4 w-4" />
      </Button>
    </div>
  );
}
