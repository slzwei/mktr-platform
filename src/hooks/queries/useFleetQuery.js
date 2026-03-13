import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FleetOwner, Car, Driver } from '@/api/entities';
import { fleet } from '@/api/client';

export function useFleetOwnersList(params = {}) {
  return useQuery({
    queryKey: ['fleetOwners', 'list', params],
    queryFn: () => FleetOwner.list(params),
  });
}

export function useCarsList(params = {}) {
  return useQuery({
    queryKey: ['cars', 'list', params],
    queryFn: () => Car.list(params),
  });
}

export function useDriversList(params = {}) {
  return useQuery({
    queryKey: ['drivers', 'list', params],
    queryFn: () => Driver.list(params),
  });
}

export function useFleetStats() {
  return useQuery({
    queryKey: ['fleet', 'stats'],
    queryFn: () => fleet.getStats(),
  });
}

export function useCreateCar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => Car.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useUpdateCar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => Car.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useDeleteCar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => Car.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useCreateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => Driver.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}

export function useUpdateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => Driver.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}

export function useDeleteDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => Driver.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}
