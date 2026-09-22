import { Box, Button, IconButton, Text, VStack } from '@chakra-ui/react';
import { useCallback, useEffect, useState } from 'react';
import { LuShirt } from 'react-icons/lu';
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useRinneOutfits } from '@/context/rinne-outfit-context';
import { footerStyles } from '@/components/footer/footer-styles';
import { inputSubtitleStyles } from '@/components/electron/electron-style';

interface OutfitPickerButtonProps {
  mode: 'window' | 'pet';
}

const PET_OUTFIT_POPOVER_COMPONENT_ID = 'outfit-picker-popover';

export function OutfitPickerButton({ mode }: OutfitPickerButtonProps) {
  const {
    available,
    profiles,
    currentProfileId,
    pendingProfileId,
    isSwitching,
    refreshCatalog,
    requestSwitch,
  } = useRinneOutfits();
  const [open, setOpen] = useState(false);
  const groups = [
    { id: 'game', label: '游戏原画' },
    { id: 'custom', label: '作者自制' },
  ] as const;

  const updatePetPopoverInteraction = useCallback((isHovering: boolean) => {
    if (mode === 'pet') {
      (window.api as any)?.updateComponentHover(
        PET_OUTFIT_POPOVER_COMPONENT_ID,
        isHovering,
      );
    }
  }, [mode]);

  const closePopover = useCallback(() => {
    setOpen(false);
    updatePetPopoverInteraction(false);
  }, [updatePetPopoverInteraction]);

  useEffect(() => () => {
    updatePetPopoverInteraction(false);
  }, [updatePetPopoverInteraction]);

  useEffect(() => {
    if (isSwitching && open) closePopover();
  }, [closePopover, isSwitching, open]);

  return (
    <PopoverRoot
      open={open}
      positioning={{ placement: mode === 'pet' ? 'top-end' : 'top-start' }}
      onOpenChange={(details) => {
        setOpen(details.open);
        if (details.open) refreshCatalog();
        if (!details.open) updatePetPopoverInteraction(false);
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          aria-label="给凛祢换衣服"
          title="给凛祢换衣服"
          disabled={!available || isSwitching}
          {...(mode === 'pet'
            ? inputSubtitleStyles.iconButton
            : footerStyles.footer.actionButton)}
          bg={mode === 'window' ? 'purple.500' : undefined}
          color={mode === 'window' ? 'white' : 'whiteAlpha.800'}
          _disabled={{ opacity: 1, cursor: 'not-allowed' }}
        >
          <LuShirt size={mode === 'window' ? 21 : 16} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        portalled
        data-no-drag="true"
        onPointerEnter={() => updatePetPopoverInteraction(true)}
        onPointerLeave={() => updatePetPopoverInteraction(false)}
        w="310px"
        maxW="calc(100vw - 24px)"
        overflow="hidden"
        bg="gray.800"
        color="white"
        borderColor="whiteAlpha.300"
        zIndex={1500}
      >
        <PopoverBody p="3" display="flex" flexDirection="column" maxH="360px">
          <Text fontWeight="semibold" mb="2">给凛祢换衣服</Text>
          {!available && (
            <Text fontSize="sm" color="whiteAlpha.600">后端连接后才能换装</Text>
          )}
          <Box minH="0" overflowY="auto" pr="1">
            {groups.map((group) => {
              const items = profiles.filter((profile) => profile.group === group.id);
              if (items.length === 0) return null;
              return (
                <Box key={group.id} mb="3">
                  <Text fontSize="xs" color="whiteAlpha.600" mb="1">
                    {group.label}
                  </Text>
                  <VStack align="stretch" gap="1">
                    {items.map((profile) => {
                      const current = profile.profile_id === currentProfileId;
                      const pending = profile.profile_id === pendingProfileId;
                      return (
                        <Button
                          key={profile.profile_id}
                          size="xs"
                          variant={current || pending ? 'solid' : 'ghost'}
                          colorPalette={pending ? 'orange' : 'purple'}
                          color="pink.100"
                          justifyContent="flex-start"
                          whiteSpace="normal"
                          height="auto"
                          minH="8"
                          py="1.5"
                          disabled={current || isSwitching}
                          _hover={{ bg: 'whiteAlpha.100', color: 'pink.100' }}
                          _disabled={{ opacity: 1, color: 'pink.100', cursor: 'default' }}
                          onClick={() => {
                            closePopover();
                            requestSwitch(profile.profile_id);
                          }}
                        >
                          {profile.menu_label}{current ? '（当前）' : pending ? '（已排队）' : ''}
                        </Button>
                      );
                    })}
                  </VStack>
                </Box>
              );
            })}
          </Box>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}
