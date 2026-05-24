import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R-13. login-form is one of the two most-touched form components. We mock
 * next/navigation (no router in jsdom) and global fetch (the BFF login route).
 */
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { LoginForm } from './login-form';

const fetchMock = vi.fn();

beforeEach(() => {
  nav.push.mockReset();
  nav.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginForm', () => {
  it('renders email, password, submit, and the forgot-password link', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
  });

  it('wires required-field accessibility on the inputs', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-required', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-required', 'true');
  });

  it('does not call the API when the form is submitted empty', async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it('posts valid credentials to the login BFF route and routes onward', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'authenticated', user: {}, tenant: {} }),
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/dashboard'));
  });
});
