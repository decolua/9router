import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

function MockDashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg">
      {sidebarOpen && (
        <div
          data-testid="overlay"
          className="fixed inset-0 z-40 bg-black/20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        data-testid="mobile-sidebar"
        className={`fixed inset-y-0 left-0 z-50 transform lg:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button onClick={() => setSidebarOpen(false)}>Close Sidebar</button>
      </div>

      <main className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300 isolate">
        <button data-testid="menu-btn" onClick={() => setSidebarOpen(true)}>Menu</button>
        <div>{children}</div>
      </main>
    </div>
  );
}

describe("DashboardLayout mobile navigation", () => {
  it("applies the correct transform classes when opened and closed", () => {
    render(
      <MockDashboardLayout>
        <div>Content</div>
      </MockDashboardLayout>
    );

    const mobileSidebar = screen.getByTestId("mobile-sidebar");
    
    expect(mobileSidebar.className).toContain("-translate-x-full");
    expect(mobileSidebar.className).not.toContain("translate-x-0");

    fireEvent.click(screen.getByTestId("menu-btn"));

    expect(mobileSidebar.className).toContain("translate-x-0");
    expect(mobileSidebar.className).not.toContain("-translate-x-full");

    const overlay = screen.getByTestId("overlay");
    fireEvent.click(overlay);

    expect(mobileSidebar.className).toContain("-translate-x-full");
  });
});


