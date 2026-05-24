import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R-13. signup-form is the other most-touched form component. Mock
 * next/navigation + fetch (slug-availability probe and the signup route).
 */
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
}));

import { SignupForm } from './signup-form';

const fetchMock = vi.fn();

beforeEach(() => {
  nav.push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignupForm', () => {
  it('renders the account fields, authorization checkbox, and submit', () => {
    const { container } = render(<SignupForm />);
    expect(screen.getByLabelText('Company name')).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    // The slug field (prefix-row wrapper) and password fields (sibling
    // strength meter) don't render as single-element label targets, so query
    // those controls directly rather than by their label association.
    expect(screen.getByPlaceholderText('acme-towing')).toBeInTheDocument();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeInTheDocument();
  });

  it('auto-derives the slug from the company name', async () => {
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Acme Towing Co' },
    });
    await waitFor(() =>
      expect(screen.getByPlaceholderText('acme-towing')).toHaveValue('acme-towing-co'),
    );
  });

  it('does not post to the signup route when the form is empty', async () => {
    render(<SignupForm />);
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }));
    await waitFor(() =>
      expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/signup', expect.anything()),
    );
  });
});
