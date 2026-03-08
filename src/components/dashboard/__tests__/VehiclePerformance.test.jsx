import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VehiclePerformance from '../VehiclePerformance';

describe('VehiclePerformance', () => {
  it('shows empty state when no cars', () => {
    render(<VehiclePerformance cars={[]} commissions={[]} />);
    expect(screen.getByText('No vehicle data available')).toBeInTheDocument();
  });

  it('renders vehicle rows with plate number and earnings', () => {
    const cars = [
      { id: 'car-1', plate_number: 'ABC-123', make: 'Toyota', status: 'active' },
      { id: 'car-2', plate_number: 'XYZ-789', make: 'Honda', status: 'maintenance' },
    ];
    const commissions = [
      { id: 'c1', carId: 'car-1', amount_fleet: 150 },
      { id: 'c2', carId: 'car-1', amount_fleet: 200 },
      { id: 'c3', carId: 'car-2', amount_fleet: 75 },
    ];
    render(<VehiclePerformance cars={cars} commissions={commissions} />);

    expect(screen.getByText('ABC-123')).toBeInTheDocument();
    expect(screen.getByText('XYZ-789')).toBeInTheDocument();
    expect(screen.getByText('$350.00')).toBeInTheDocument();
    expect(screen.getByText('$75.00')).toBeInTheDocument();
  });

  it('sorts vehicles by earnings descending', () => {
    const cars = [
      { id: 'car-1', plate_number: 'LOW-001', make: 'Ford', status: 'active' },
      { id: 'car-2', plate_number: 'HIGH-002', make: 'BMW', status: 'active' },
    ];
    const commissions = [
      { id: 'c1', carId: 'car-1', amount_fleet: 50 },
      { id: 'c2', carId: 'car-2', amount_fleet: 500 },
    ];
    render(<VehiclePerformance cars={cars} commissions={commissions} />);

    const rows = screen.getAllByRole('row');
    // row[0] is thead, row[1] should be highest earner
    expect(rows[1]).toHaveTextContent('HIGH-002');
    expect(rows[2]).toHaveTextContent('LOW-001');
  });
});
