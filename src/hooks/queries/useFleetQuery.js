import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as fleetService from '@/services/fleetService';

export function useFleetOwnersList(params = {}) {
  return useQuery({
    queryKey: ['fleetOwners', 'list', params],
    queryFn: () => fleetService.listFleetOwners(params),
  });
}

export function useCarsList(params = {}) {
  return useQuery({
    queryKey: ['cars', 'list', params],
    queryFn: () => fleetService.listCars(params),
  });
}

export function useDriversList(params = {}) {
  return useQuery({
    queryKey: ['drivers', 'list', params],
    queryFn: () => fleetService.listDrivers(params),
  });
}

export function useFleetStats() {
  return useQuery({
    queryKey: ['fleet', 'stats'],
    queryFn: () => fleetService.getFleetStats(),
  });
}

export function useCreateCar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => fleetService.createCar(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useUpdateCar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => fleetService.updateCar(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useDeleteCar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => fleetService.deleteCar(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cars'] }),
  });
}

export function useCreateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => fleetService.createDriver(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}

export function useUpdateDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => fleetService.updateDriver(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}

export function useDeleteDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => fleetService.deleteDriver(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['drivers'] }),
  });
}
