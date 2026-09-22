'use client';

import {
  Toaster as ChakraToaster,
  Portal,
  Spinner,
  Stack,
  Toast,
  createToaster,
} from '@chakra-ui/react';

export const toaster = createToaster({
  placement: 'top-end',
  pauseOnPageIdle: true,
  max: 5,
});

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: '4' }}>
        {(toast) => {
          const isDailyChildEvent = toast.meta?.source === 'daily-child-events';
          const statusBackground = toast.type === 'error' ? 'red.600' : 'green.600';
          return (
            <Toast.Root
              width={{ md: 'sm' }}
              background={isDailyChildEvent ? statusBackground : undefined}
              color={isDailyChildEvent ? 'white' : undefined}
              borderColor={isDailyChildEvent ? 'whiteAlpha.400' : undefined}
              boxShadow={isDailyChildEvent ? 'lg' : undefined}
            >
              {toast.type === 'loading' ? (
                <Spinner size="sm" color="blue.solid" />
              ) : (
                <Toast.Indicator color={isDailyChildEvent ? 'white' : undefined} />
              )}
              <Stack gap="1" flex="1" maxWidth="100%">
                {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
              </Stack>
              {toast.action && <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>}
              {toast.meta?.closable && <Toast.CloseTrigger />}
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
}
