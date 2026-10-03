; TH04 v1.00 MAIN.EXE experiment. All addresses refer to verified original.
; Inserted at image 130E0h, extending the existing main_01 code group.
bits 16
cpu 386
org 0x85f0
%define BASE 0xaaf0
%define ORIGINAL(a) (a-BASE)
%define RESOURCE_SIZE 16
%define PLAYER_CAPACITY 4
%define R_POWER 0
%define R_LEVEL 1
%define R_OVERFLOW 2
%define R_LIVES 4             ; original convention: includes current life
%define R_BOMBS 5
%define R_OUT 6
%define R_SHOT_FUNC 8

; Fixed entry table consumed by build_lab.py. No new MZ relocations needed.
dw init_hook, update_hook, render_hook, invalidate_hook, shot_hook, mailbox
dw item_hittest, aim_hook, atan_pointer
dw award_enter, award_leave, sound_pointer, retire_hook, extend_hook
dw stage_bomb_hook, hud_render, resource_store, resource_load, swap_player
dw resource_init, restart_players
dw sprite_load, sprite_load_pointer, shots_update, shots_render, shots_invalidate
dw laser_damage, run_config
dw bomb_load, bomb_start, bomb_render, bomb_owner, sprite_swap
dw coop_tick, ghosts_render, stage_revive, rescue_state, ghosts_invalidate
dw rescue_hud
dw p2_collision
dw p3_input, p3_motion, boss_damage_scale, midboss_damage_scale
dw resistant_boss_damage
dw guest_bank, scale_damage
dw net_pause_enter, net_pause_sense, net_pause_wait, net_pause_state
dw net_pause_delay_ptr, net_pause_sense_ptr, net_pause_wait_ptr
dw offline_input_hook, offline_mask, offline_sense_ptr

init_hook:
    call ORIGINAL(0xb1d0)
    pushad
    push es
    push cs
    pop es
    cld
    mov si,0x464c
    mov di,p2_motion
    mov cx,24
    rep movsb
    mov si,0x4666
    mov di,p2_flags
    mov cx,5
    rep movsb
    mov si,0x466c
    mov di,p2_options
    mov cx,8
    rep movsb
    mov si,0x4679
    mov di,p2_explosion
    mov cx,3
    rep movsb
    mov word [cs:p2_motion+2],240*16
    mov word [cs:p2_motion+6],240*16
    mov word [0x464e],144*16
    mov word [0x4652],144*16
    xor eax,eax
    mov [cs:p2_motion+10],eax
    mov [cs:p2_motion+23],al
    mov [cs:p2_flags],al
    mov [cs:p2_flags+3],al
    mov [cs:p2_flags+4],al
    mov [cs:active_p2],al
    mov al,[cs:run_config+10]
    mov [cs:player_count],al
    mov byte [cs:guest_slot],1
    call resource_init
    call resource_load
    mov word [cs:p2_laser],0
    mov byte [cs:p2_ring],0
    mov byte [cs:bomb_owner],0
    mov word [cs:p2_input],0
    mov byte [cs:p2_focus],0
    mov byte [cs:ready],1
    mov [cs:guest_ds],ds
    mov di,grazed
    xor ax,ax
    mov cx,440
    rep stosb
    mov di,shot_owners
    mov cx,68
    rep stosb
    call init_third
    inc word [cs:stage_generation]
    xor eax,eax
    call rescue_reset
    pop es
    popad
    ret

; Bind the original single-player engine to one player's resource slot.
; Only score/world/bomb-effect state stays shared.
swap_player:
    pushad
    call resource_store
    mov si,0x464c
    mov di,p2_motion
    mov cx,24
    call swap_bytes
    mov si,0x4666
    mov di,p2_flags
    mov cx,5
    call swap_bytes
    mov si,0x466c
    mov di,p2_options
    mov cx,8
    call swap_bytes
    mov si,0x4679
    mov di,p2_explosion
    mov cx,3
    call swap_bytes
    mov si,0x42c8
    mov di,p2_laser
    mov cx,16
    call swap_bytes
    mov si,0x18da
    mov di,p2_ring
    mov cx,1
    call swap_bytes
    mov al,[cs:guest_slot]
    xor [cs:active_p2],al
    call resource_load
    popad
    ret
swap_bytes:
    mov al,[si]
    xchg al,[cs:di]
    mov [si],al
    inc si
    inc di
    loop swap_bytes
    ret

update_hook:
    cmp byte [cs:resources+R_OUT],0
    jne .p1_out
    call ORIGINAL(0x10abf)
.p1_out:
    pushad
    push es
    ; P1 spawns before P2 this frame. Clear tags on newly reused P1 slots.
    mov si,0xb55e
    xor di,di
    mov cx,68
.owners:
    cmp byte [si],1
    jne .owner_next
    cmp byte [si+1],0
    jne .owner_next
    mov byte [cs:shot_owners+di],0
.owner_next:
    add si,18
    inc di
    loop .owners
    inc dword [cs:ticks]
    mov [cs:guest_ds],ds
    mov eax,[0x464e]
    mov [cs:p1_xy],eax
    mov ax,[0x538a]
    mov [cs:stage_frame],ax
    mov al,[0x466a]
    mov [cs:p1_miss],al
    mov al,[0x4662]
    mov [cs:p1_invincible],al
    mov bx,update_guest
    call for_guests
    call coop_tick
    pop es
    popad
    ret

update_guest:
    mov ax,[0x3974]
    push ax
    mov al,[0x3976]
    push ax
    mov ax,[cs:p2_input]
    cmp byte [cs:guest_slot],2
    jne .input
    mov ax,[cs:p3_input]
.input:
    and ax,0x3f             ; movement, personal bomb (10h), fire (20h)
    mov [0x3974],ax
    mov al,[cs:p2_focus]
    cmp byte [cs:guest_slot],2
    jne .focus
    mov al,[cs:p3_focus]
.focus:
    mov [0x3976],al
    call swap_player
    call guest_out
    jne .p2_out
    call ORIGINAL(0x10abf)
.p2_out:
    call swap_player
    pop ax
    mov [0x3976],al
    pop ax
    mov [0x3974],ax
    ret

shot_hook:
    ; Snapshot free slots: one original shot function may allocate many shots.
    pushad
    mov si,0xb55e
    xor di,di
    mov cx,68
.before:
    mov al,[si]
    mov [cs:shot_before+di],al
    add si,18
    inc di
    loop .before
    popad
    call word [0x449a]
    pushad
    cmp byte [cs:active_p2],0
    je .tag
    inc dword [cs:shot_calls]
.tag:
    mov si,0xb55e
    xor di,di
    mov cx,68
    mov al,[cs:active_p2]
    shl al,1
.after:
    cmp byte [cs:shot_before+di],0
    jne .next
    cmp byte [si],1
    jne .next
    mov [cs:shot_owners+di],al
.next:
    add si,18
    inc di
    loop .after
    popad
    ret

invalidate_hook:
    call ghosts_invalidate
    call ORIGINAL(0x107e2)
    mov bx,invalidate_guest
    call for_guests
    ret
invalidate_guest:
    call swap_player
    call ORIGINAL(0x107e2)
    call swap_player
    ret

render_hook:
    pushad
    mov si,0xb55e
    xor di,di
    mov cx,68
.shot_hits:
    cmp byte [cs:shot_owners+di],2
    jne .shot_next
    cmp byte [si],2
    jb .shot_next
    cmp byte [si],18
    jae .clear_owner
    inc dword [cs:shot_hits]
.clear_owner:
    mov byte [cs:shot_owners+di],0
.shot_next:
    add si,18
    inc di
    loop .shot_hits
    mov bx,p2_collision
    call for_guests
    popad
    cmp byte [cs:resources+R_OUT],0
    jne .skip_p1
    call ORIGINAL(0x10bfd)
.skip_p1:
    mov bx,render_guest
    call for_guests
    call resource_store
    call hud_render
    call rescue_hud
    ret
render_guest:
    call guest_out
    jne .done
    call swap_player
    call sprite_swap
    call ORIGINAL(0x10bfd)
    call sprite_swap
    call swap_player
.done:
    ret

p2_collision:
    push bx
    push bp
    mov bx,bullet_ages
    mov bp,grazed
    cmp byte [cs:guest_slot],2
    jne .bank_ready
    mov bx,p3_ages
    mov bp,p3_grazed
.bank_ready:
    call guest_out
    jne .ret
    cmp byte [cs:p2_motion+22],0
    jne .ret
    cmp byte [cs:p2_flags+4],0
    jne .ret
    cmp byte [0x4368],0      ; shared bomb protection
    jne .ret
    cmp byte [0xbcba],0     ; bullet clear frames
    jne .ret
    cmp byte [0xbcb9],0     ; bullet zap
    jne .ret
    mov si,0x5a22           ; 86B8h - 439 * sizeof(bullet_t)
    xor di,di
    mov cx,440
.bullet:
    cmp byte [si],1
    jne .reset_graze
    cmp byte [si+0x12],3    ; spawn clouds have no hitbox
    jae .reset_graze
    cmp byte [si+0x13],4    ; decaying bullets have no hitbox
    jae .reset_graze
    cmp byte [si+1],1
    ja .old
    ; Age is an 8-bit counter. Its ordinary 255 -> 0 -> 1 wrap is NOT a
    ; new projectile and must not award another graze for a long-lived one.
    cmp byte [cs:bx+di],254
    jae .old
    cmp byte [cs:bx+di],1
    jbe .old
    mov byte [cs:bp+di],0
.old:
    mov ax,[si+2]
    sub ax,[cs:p2_motion+2]
    mov dx,[si+4]
    sub dx,[cs:p2_motion+4]
    ; BSF_GRAZED=1 belongs to P1. P2 has an independent sidecar flag.
    cmp byte [si+0x12],2
    je .killbox
    cmp byte [cs:bp+di],0
    jne .killbox
    ; TH04 requires a previous graze. Keep P2's graze flags independent.
    add ax,16*16
    cmp ax,36*16
    ja .next
    add dx,22*16
    cmp dx,44*16
    ja .next
    mov byte [cs:bp+di],1
    call p2_graze_award
    jmp .next
.killbox:
    add ax,4*16
    cmp ax,8*16
    ja .next
    add dx,4*16
    cmp dx,8*16
    ja .next
    mov byte [si],2
    jmp .hit
.reset_graze:
    mov byte [cs:bp+di],0
.next:
    mov al,[si+1]
    mov [cs:bx+di],al
    add si,26
    inc di
    dec cx
    jnz .bullet
    ; Ordinary enemy contact (same 24x24 box as the original).
    mov si,0x8a92
    mov cx,32
.enemy:
    cmp byte [si],1
    jne .enemy_next
    cmp byte [si+0x2a],0
    je .enemy_next
    mov ax,[si+2]
    sub ax,[cs:p2_motion+2]
    add ax,12*16
    cmp ax,24*16
    jae .enemy_next
    mov ax,[si+4]
    sub ax,[cs:p2_motion+4]
    add ax,12*16
    cmp ax,24*16
    jb .hit
.enemy_next:
    add si,64
    loop .enemy
.ret:
    pop bp
    pop bx
    ret
.hit:
    cmp byte [cs:p2_flags+3],0
    jne .ret
    mov byte [cs:p2_flags+3],1
    inc dword [cs:hit_count]
    jmp .ret

; Match original MAIN 1CAA9..1CAC5: 999 cap, shared HUD and rank-specific
; score_delta. Do not touch P1's bullet spawn/graze state.
p2_graze_award:
    cmp word [0xbcbc],999
    jae .ret
    pushad
    push es
    inc word [0xbcbc]
    push cs
    call ORIGINAL(0xf091) ; original far hud_graze_put()
    movzx eax,word [0xbcbe]
    add [0x435a],eax
    pop es
    popad
.ret:
    ret

; AX/DX are the item's updated position. CF=1 collects exactly once.
item_hittest:
    mov byte [cs:item_owner],0
    push cx
    push ax
    push dx
    push bp
    push si
    push di
    mov bp,ax
    mov di,dx
    xor bx,bx
.slot:
    call player_info
    cmp byte [cs:si+R_OUT],0
    jne .next
    test ch,ch
    jnz .next
    add ax,24*16
    sub ax,bp
    cmp ax,48*16
    ja .next
    add dx,24*16
    sub dx,di
    cmp dx,38*16
    ja .next
    mov [cs:item_owner],bl
    test bx,bx
    jz .collected
    inc dword [cs:item_pickups]
.collected:
    pop di
    pop si
    pop bp
    pop dx
    pop ax
    pop cx
    stc
    retf
.next:
    inc bx
    cmp bl,[cs:player_count]
    jb .slot
    pop di
    pop si
    pop bp
    pop dx
    pop ax
    pop cx
    clc
    retf

aim_hook:
    push bp
    mov bp,sp
    pushad
    mov dword [cs:aim_best],0x7fffffff
    xor bx,bx
.slot:
    call player_info
    cmp byte [cs:si+R_OUT],0
    jne .next
    test ch,ch
    jnz .next
    sub ax,[0x464e]
    add ax,[bp+6]
    sub dx,[0x4650]
    add dx,[bp+8]
    movsx ecx,ax
    movsx esi,dx
    imul ecx,ecx
    imul esi,esi
    add ecx,esi
    cmp ecx,[cs:aim_best]
    jae .next
    mov [cs:aim_best],ecx
    mov [cs:aim_x],ax
    mov [cs:aim_y],dx
    mov [cs:aim_slot],bl
.next:
    inc bx
    cmp bl,[cs:player_count]
    jb .slot
    cmp dword [cs:aim_best],0x7fffffff
    je .done
    mov ax,[cs:aim_x]
    mov [bp+6],ax
    mov ax,[cs:aim_y]
    mov [bp+8],ax
    cmp byte [cs:aim_slot],0
    je .done
    inc dword [cs:p2_targets]
.done:
    popad
    pop bp
    jmp far [cs:atan_pointer]
atan_pointer: dw 0x1da8,0   ; segment relocated by build_lab.py

resource_index:
    movzx si,byte [cs:active_p2]
    shl si,4
    add si,resources
    ret
resource_store:
    pushad
    push es
    call resource_index
    cmp byte [cs:si+R_OUT],2
    je .done
    mov ax,[0x4664]
    mov [cs:si+R_POWER],ax
    mov ax,[0x2396]
    mov [cs:si+R_OVERFLOW],ax
    mov ax,[0x449a]
    mov [cs:si+R_SHOT_FUNC],ax
    les bx,[0xba86]
    mov al,[es:bx+0x0b]
    mov [cs:si+R_LIVES],al
    mov al,[es:bx+0x0d]
    mov [cs:si+R_BOMBS],al
.done:
    pop es
    popad
    ret
resource_load:
    pushad
    push es
    call resource_index
    mov ax,[cs:si+R_POWER]
    mov [0x4664],ax
    mov ax,[cs:si+R_OVERFLOW]
    mov [0x2396],ax
    ; The level table is as important as the current function: Power pickups
    ; and death losses recompute the latter through the former.
    movzx bx,byte [cs:active_p2]
    shl bx,1
    movzx ax,byte [cs:run_config+4+bx]
    mov dx,ax
    shl ax,1
    mov bl,[cs:run_config+5+bx]
    xor bh,bh
    add bx,ax
    imul bx,20
    add bx,0x1b0c
    mov [0x449c],bx
    add dx,38
    mov [0x4674],dx
    movzx ax,byte [cs:si+R_LEVEL]
    shl ax,1
    add bx,ax
    mov ax,[bx]
    mov [0x449a],ax
    mov [cs:si+R_SHOT_FUNC],ax
    les bx,[0xba86]
    mov al,[cs:si+R_LIVES]
    mov [es:bx+0x0b],al
    mov al,[cs:si+R_BOMBS]
    mov [es:bx+0x0d],al
    pop es
    popad
    ret
resource_init:
    call resource_store
    cmp byte [cs:resources_ready],0
    jne .ret
    call seed_resources
    mov byte [cs:resources_ready],1
.ret:
    ret
seed_resources:
    pushad
    call resource_index
    mov di,resources
    movzx cx,byte [cs:player_count]
.slot:
    cmp byte [cs:di+R_OUT],2
    je .next
    mov eax,[cs:si]
    mov [cs:di],eax
    mov eax,[cs:si+4]
    mov [cs:di+4],eax
    mov byte [cs:di+R_OUT],0
    mov eax,[cs:si+8]
    mov [cs:di+8],eax
.next:
    add di,RESOURCE_SIZE
    loop .slot
    popad
    ret

; The original item award runs once, with the collector's complete context.
award_enter:
    cmp byte [cs:item_owner],2
    jne .bank_ready
    call guest_bank
.bank_ready:
    cmp byte [cs:item_owner],0
    je .ret
    call swap_player
.ret:
    retf
award_leave:
    pushad
    push es
    les bx,[0xba86]
    cmp byte [es:bx+0x0b],100
    jbe .bomb_cap
    mov byte [es:bx+0x0b],100
.bomb_cap:
    cmp byte [es:bx+0x0d],99
    jbe .restore
    mov byte [es:bx+0x0d],99
.restore:
    cmp byte [cs:item_owner],0
    je .p1
    call swap_player
.p1:
    cmp byte [cs:guest_slot],2
    jne .bank_ready
    call guest_bank
.bank_ready:
    call resource_store
    call share_item_resource
    mov byte [si],2
    push word 11
    call far [cs:sound_pointer]
    pop es
    popad
    retf
sound_pointer: dw 0x7d2,0x130e ; rebased and relocated by builder

; The collector already received the original award. Share only the stock
; increment, so item removal, score, sound and popup still happen once.
share_item_resource:
    pushad
    mov bx,R_BOMBS
    mov ah,99
    cmp byte [si+14],4
    je .team
    cmp byte [si+14],5
    jne .done
    mov bx,R_LIVES
    mov ah,100
.team:
    mov si,resources
    xor dx,dx
    movzx cx,byte [cs:player_count]
.slot:
    cmp byte [cs:si+R_OUT],2
    je .next
    cmp dl,[cs:item_owner]
    je .next
    cmp bx,R_LIVES
    je .increment
    cmp byte [cs:si+R_OUT],0
    jne .next
.increment:
    cmp [cs:si+bx],ah
    jae .next
    inc byte [cs:si+bx]
    cmp bx,R_LIVES
    jne .next
    cmp byte [cs:si+R_OUT],0
    je .next
    call revive_item_player
.next:
    add si,RESOURCE_SIZE
    inc dx
    loop .slot
    call resource_load
.done:
    popad
    ret

; Only a retired teammate is revived. Keep their power and Bomb stock,
; clear the frozen death state and give the normal 150-frame protection.
; DX is the player index; pickup processing otherwise runs in P1 context.
revive_item_player:
    cmp byte [cs:si+R_OUT],2
    jne .online
    ret
.online:
    pushad
    mov byte [cs:si+R_OUT],0
    call resource_load
    cmp dl,2
    jne .bank_ready
    call guest_bank
.bank_ready:
    test dl,dl
    jz .bound
    call swap_player
.bound:
    movzx bx,dl
    shl bx,1
    mov ax,[cs:spawn_x+bx]
    mov [0x464e],ax
    mov [0x4652],ax
    mov word [0x4650],320*16
    mov word [0x4654],320*16
    xor eax,eax
    mov [0x4656],eax
    mov word [0x4662],150
    mov [0x4669],ax
    mov [0x4666],al
    mov [0x4679],ax
    mov [0x467b],al
    mov [0x42c8],ax
    test dl,dl
    jz .done
    call swap_player
    cmp dl,2
    jne .done
    call guest_bank
.done:
    popad
    ret

retire_hook:
    pushad
    push es
    call resource_index
    cmp byte [cs:si+R_OUT],2
    je .survivor
    mov byte [cs:si+R_OUT],1
    les bx,[0xba86]
    mov byte [es:bx+0x0b],0
    mov byte [0x4669],0
    mov byte [0x466a],1
    mov byte [0x4662],255
    movzx bx,byte [cs:active_p2]
    shl bx,1
    mov ax,[cs:spawn_x+bx]
    mov [0x464e],ax
    mov [0x4652],ax
    mov word [0x4650],320*16
    mov word [0x4654],320*16
    mov word [0x42c8],0
    call rescue_reset
    call resource_store
    mov si,resources
    movzx cx,byte [cs:player_count]
.alive:
    cmp byte [cs:si+R_OUT],0
    je .survivor
    add si,RESOURCE_SIZE
    loop .alive
    pop es
    popad
    call ORIGINAL(0xe541)
    test al,al
    jnz .ret
    call restart_players
.ret:
    ret
.survivor:
    pop es
    popad
    xor ax,ax
    ret

restart_players:
    pushad
    call rescue_reset
    mov word [0x2396],0
    call resource_store
    call seed_resources
    ; Return to P1 for the loop, then restore the interrupted player's binding.
    movzx bp,byte [cs:active_p2]
    test bp,bp
    jz .p1
    call swap_player
.p1:
    cmp byte [cs:guest_slot],2
    jne .banks
    call guest_bank
.banks:
    xor dx,dx
.slot:
    mov si,dx
    shl si,4
    add si,resources
    call revive_item_player
    inc dx
    cmp dl,[cs:player_count]
    jb .slot
    test bp,bp
    jz .done
    cmp bp,2
    jne .bind
    call guest_bank
.bind:
    call swap_player
.done:
    popad
    ret

extend_hook:
    pushad
    call resource_store
    mov si,resources
    movzx cx,byte [cs:player_count]
.slot:
    cmp byte [cs:si+R_OUT],0
    jne .next
    cmp byte [cs:si+R_LIVES],100
    jae .next
    inc byte [cs:si+R_LIVES]
.next:
    add si,RESOURCE_SIZE
    loop .slot
    call resource_load
    popad
    ret
stage_bomb_hook:
    pushad
    call resource_store
    mov si,resources
    movzx cx,byte [cs:player_count]
.slot:
    cmp byte [cs:si+R_OUT],0
    jne .next
    cmp byte [cs:si+R_BOMBS],99
    jae .next
    inc byte [cs:si+R_BOMBS]
.next:
    add si,RESOURCE_SIZE
    loop .slot
    call stage_revive
    call resource_load
    popad
    retf

; Native PC-98 text VRAM, inside the existing right-hand panel. 22 columns
; leave the playfield and borders untouched. The same two-row card supports
; up to four slots without moving the original score / point / dream / graze.
hud_render:
    pushad
    push es
    call hud_graphics_clear
    mov ax,0xa000
    mov es,ax
    mov di,7*160+56*2
    mov dx,8
.clear_row:
    mov cx,22
.clear_cell:
    mov word [es:di],0x20
    ; The right side of graphics VRAM is TH04's tile cache. Opaque black
    ; reverse spaces mask it; ordinary transparent spaces expose the cache.
    mov word [es:di+0x2000],0x05
    add di,2
    loop .clear_cell
    add di,160-44
    dec dx
    jnz .clear_row
    ; Boss HP occupies the former shared power rows 21/22; do not erase it.
    xor bp,bp
    mov bx,resources
    mov di,7*160+56*2
.player:
    push di
    mov ah,[cs:hud_colors+bp]
    mov si,hud_player
    call hud_text
    mov ax,bp
    add al,'1'
    mov ah,[cs:hud_colors+bp]
    call hud_char
    add di,12                  ; column 64: lives beside player name
    push word 49               ; PAT_ITEM + IT_1UP
    call hud_icon
    add di,2
    movzx ax,byte [cs:bx+R_LIVES]
    test ax,ax
    jz .life
    dec ax                     ; display spare lives, as original HUD does
.life:
    call hud_number
    pop di
    add di,160
    push di
    cmp byte [cs:bx+R_OUT],0
    je .living
    mov ah,0x41
    mov si,hud_out
    cmp byte [cs:bx+R_OUT],2
    jne .out_text
    mov si,hud_offline
.out_text:
    call hud_text
    jmp .next
.living:
    ; Second row: Power on the left, Bomb aligned beneath lives.
    push word 47               ; PAT_ITEM + IT_BIGPOWER
    call hud_icon
    add di,2
    movzx ax,byte [cs:bx+R_POWER]
    imul ax,100
    xor dx,dx
    mov cx,32
    div cx                     ; raw 0..128 -> decimal 0.00..4.00
    xor dx,dx
    mov cx,100
    div cx
    push dx
    add al,'0'
    mov ah,0xe1
    call hud_char
    mov al,'.'
    call hud_char
    pop ax
    call hud_number
    add di,2                   ; column 64: original Bomb pickup
    push word 48               ; PAT_ITEM + IT_BOMB
    call hud_icon
    add di,2
    movzx ax,byte [cs:bx+R_BOMBS]
    call hud_number
.next:
    pop di
    add di,160
    add bx,RESOURCE_SIZE
    inc bp
    movzx ax,byte [cs:player_count]
    cmp bp,ax
    jb .player
    xor al,al
    out 0x7c,al
    pop es
    popad
    ret

; Graphics scroll globally, while TRAM does not. Clear only our dedicated
; icon columns across all scanlines on the current back page, removing old
; icon trails before drawing at the current hardware-scroll offset. The
; playfield ends at x=416; tile cache begins at x=576. Never touch either.
hud_graphics_clear:
    pushad
    push es
    mov al,0xc0
    out 0x7c,al
    xor al,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    mov ax,0xa800
    mov es,ax
    mov di,448/8
    mov cx,400
.row:
    mov dword [es:di],0xffffffff
    mov dword [es:di+4],0xffffffff
    mov word [es:di+8],0xffff    ; x=448..527; both pages updated as they flip
    add di,80
    loop .row
    pop es
    popad
    ret

; DI is the native text-cell offset; the stack argument is the very same
; sprite pattern used by items_render. Open exactly two transparent cells.
hud_icon:
    push bp
    mov bp,sp
    pushad
    push es
    mov ax,di
    xor dx,dx
    mov cx,160
    div cx
    mov si,dx
    shl si,2                   ; (column * 2) -> pixel x
    shl ax,8                   ; text row -> subpixel y (16 px * 16)
    push ax
    call ORIGINAL(0xbc10)
    mov dx,ax
    mov ax,0xa800
    mov es,ax
    mov ax,si
    push word [bp+4]
    call ORIGINAL(0xc546)
    pop es
    popad
    mov word [es:di+0x2000],1
    mov word [es:di+0x2002],1
    add di,4
    pop bp
    ret 2
hud_text:
    mov al,[cs:si]
    inc si
    test al,al
    jz .ret
    call hud_char
    jmp hud_text
.ret:
    ret
hud_char:
    mov [es:di],al
    mov byte [es:di+1],0
    mov [es:di+0x2000],ah
    cmp al,' '
    jne .colored
    mov byte [es:di+0x2000],0x05
.colored:
    mov byte [es:di+0x2001],0
    add di,2
    ret
hud_number:
    xor dx,dx
    mov cx,10
    div cx
    push dx
    add al,'0'
    mov ah,0xe1
    call hud_char
    pop ax
    add al,'0'
    mov ah,0xe1
    call hud_char
    ret
hud_colors: db 0xa1,0xc1,0x81,0x61
hud_player: db 'P',0
hud_out: db 'OUT - SPECTATING',0

align 4
mailbox:
    db 'TH04COOPLABv001!'
ticks: dd 0                 ; +16
guest_ds: dw 0              ; +20
p2_input: dw 0              ; +22
p2_focus: db 0              ; +24
ready: db 0                 ; +25
stage_generation: dw 0      ; +26
shot_calls: dd 0            ; +28
hit_count: dd 0             ; +32
p1_xy: dd 0                 ; +36
stage_frame: dw 0           ; +40
p1_miss: db 0               ; +42
p1_invincible: db 0         ; +43
p2_motion: times 24 db 0    ; +44: prev input, cur/prev/velocity, speeds, invuln, entry
p2_flags: times 5 db 0      ; +68: shot time, misc, misc, hit, miss time
p2_options: times 8 db 0    ; +73
p2_explosion: times 3 db 0  ; +81
active_p2: db 0             ; +84
shot_hits: dd 0             ; +85, original shot hit transitions for tagged P2 shots
grazed: times 440 db 0
shot_owners: times 68 db 0
item_pickups: dd 0         ; mailbox +597
p2_targets: dd 0           ; mailbox +601, includes item attraction
resource_schema: db 1      ; +605
player_count: db 2         ; +606; immutable run_config count: 2 or 3
player_capacity: db PLAYER_CAPACITY ; +607
resource_stride: db RESOURCE_SIZE   ; +608
resources: times PLAYER_CAPACITY*RESOURCE_SIZE db 0 ; +609
resources_ready: db 0
item_owner: db 0

; Immutable per-run configuration, patched in the private disk before boot.
db 'TH04LOADOUTv1!'
run_config: db 2,1,3,2,0,0,1,0,0,0,2
p2_laser: times 16 db 0
p2_ring: db 0
shot_before: times 68 db 0
sprites_ready: db 0
p2_sprite_sizes: times 3 dw 0
p2_sprite_data: times 3 dw 0
p2_sprite_file: db 'mari.bft',0

; Both .BFTs use patterns 0..2. Keep the guest descriptors outside the
; original table and bind them only during P2 rendering. Subsequent original
; assets still start at pattern 3, and stage assets still start at 128.
sprite_load:
    push bp
    mov bp,sp
    push word [bp+8]
    push word [bp+6]
    call far [cs:sprite_load_pointer]
    pushad
    push es
    mov al,[cs:run_config+4]
    xor al,1
    test al,al
    jnz .filename
    mov dword [cs:p2_sprite_file],'miko'
.filename:
    push cs
    push word p2_sprite_file
    call far [cs:sprite_load_pointer]
    cmp word [0x07a8],6
    jne .done
    xor bx,bx
.copy:
    mov ax,[0x2eca+bx]
    mov [cs:p2_sprite_sizes+bx],ax
    mov ax,[0x2aca+bx]
    mov [cs:p2_sprite_data+bx],ax
    mov word [0x2eca+bx],0
    add bx,2
    cmp bx,6
    jb .copy
    mov word [0x07a8],3
    mov byte [cs:sprites_ready],1
.done:
    pop es
    popad
    pop bp
    retf 4
sprite_load_pointer: dw 0x2a74,0

sprite_swap:
    push bx
    push ax
    movzx bx,byte [cs:active_p2]
    shl bx,1
    mov al,[cs:run_config+4+bx]
    cmp al,[cs:run_config+4]
    pop ax
    pop bx
    je .ret
    cmp byte [cs:sprites_ready],1
    jne .ret
    pushad
    mov si,0x2ec4
    mov di,p2_sprite_sizes
    mov cx,6
    call swap_bytes
    mov si,0x2ac4
    mov di,p2_sprite_data
    mov cx,6
    call swap_bytes
    popad
.ret:
    ret

shots_update:
    call ORIGINAL(0x104b6) ; shared ordinary bullet pool, once per frame
    mov bx,shots_update_guest
    call for_guests
    ret
shots_update_guest:
    call swap_player
    cmp word [0x42c8],0
    je .done
    mov eax,[0x42cc]
    mov [0x42d0],eax
    mov eax,[0x466c]
    mov [0x42cc],eax
    dec word [0x42c8]
.done:
    call swap_player
    ret

shots_render:
    call ORIGINAL(0x10552)
    mov bx,shots_render_guest
    call for_guests
    ret
shots_render_guest:
    call swap_player
    call ORIGINAL(0xc156)
    call ORIGINAL(0xe1f4)
    mov dx,0x7c
    xor al,al
    out dx,al
    call swap_player
    ret

shots_invalidate:
    call ORIGINAL(0x10444)
    mov bx,shots_invalidate_guest
    call for_guests
    ret
shots_invalidate_guest:
    call swap_player
    ; Enter the original laser-only tail with its expected stack frame.
    call .laser
    call swap_player
    ret
.laser:
    push bp
    mov bp,sp
    push si
    push di
    jmp ORIGINAL(0x10473)

laser_damage:
    ; Called inside shots_hittest, BP still addresses that routine's locals.
    ; Add the guest laser once, before the shared score/damage accumulation.
    push ax
    push bx
    push cx
    push dx
    cmp byte [0x538c],0
    je .done
    mov cx,1
.guest:
    push cx
    cmp word [cs:p2_laser],32
    jbe .next_guest
    mov ax,[bp-8]
    cmp ax,[cs:p2_laser+6]
    ja .next_guest
    mov dx,[cs:p2_laser+4]
    sub dx,24*16
    mov cx,2
.beam:
    mov ax,dx
    sub ax,[bp-6]
    cmp ax,[bp-10]
    ja .next
    add di,3
.next:
    add dx,48*16
    loop .beam
.next_guest:
    pop cx
    cmp byte [cs:player_count],3
    jne .done
    call guest_bank
    inc cx
    cmp cx,3
    jb .guest
.done:
    pop dx
    pop cx
    pop bx
    pop ax
    movzx eax,di ; displaced original instruction
    ret

; A shared Bomb has one immutable owner. Only its rendering temporarily
; borrows that character's resources; world/dialog state always returns to P1.
bomb_owner: db 0
p2_bomb_bb: dw 0
bomb_load:
    call ORIGINAL(0xff34)
    pushad
    push es
    mov al,[cs:run_config+4]
    xor al,1
    ; CDG slot 63 is outside all original MAIN slots (0..31). Swapping
    ; descriptors keeps both allocations owned by cdg_free_all at shutdown.
    call bomb_cdg_swap
    push word [0x436e]
    les bx,[0xba86]
    mov dl,[es:bx+18]
    push dx
    add al,'0'
    mov [es:bx+18],al
    call ORIGINAL(0xff34)
    mov ax,[0x436e]
    mov [cs:p2_bomb_bb],ax
    pop dx
    les bx,[0xba86]
    mov [es:bx+18],dl
    pop word [0x436e]
    call bomb_cdg_swap
.done:
    pop es
    popad
    ret

bomb_start:
    push ax
    mov al,[cs:active_p2]
    mov [cs:bomb_owner],al
    pop ax
    mov byte [0x4368],1 ; displaced original instruction, after stock checks
    ret

bomb_cdg_swap:
    pushad
    mov si,0x3978
    mov di,0x3d68
    mov cx,8
.word:
    mov ax,[si]
    xchg ax,[di]
    mov [si],ax
    add si,2
    add di,2
    loop .word
    popad
    ret

bomb_render:
    push ax
    push bx
    movzx bx,byte [cs:bomb_owner]
    shl bx,1
    mov al,[cs:run_config+4+bx]
    cmp al,[cs:run_config+4]
    pop bx
    pop ax
    je .p1
    push word [0x436e]
    push word [0x436c]
    push word [0x5398]
    mov ax,[cs:p2_bomb_bb]
    mov [0x436e],ax
    mov al,[cs:run_config+4]
    xor al,1
    mov [0x5398],al
    mov word [0x436c],ORIGINAL(0x1004d)
    test al,al
    jz .bound
    mov word [0x436c],ORIGINAL(0x10113)
.bound:
    call bomb_cdg_swap
    call ORIGINAL(0x1020a)
    call bomb_cdg_swap
    pop word [0x5398]
    pop word [0x436c]
    pop word [0x436e]
    jmp ghosts_render
.p1:
    call ORIGINAL(0x1020a)
    ; Background/Bomb first, then ghosts, then every enemy bullet layer.
    jmp ghosts_render

%include "patches/ghosts.asm"
bullet_ages: times 440 db 0

%include "patches/three-player.asm"
%include "patches/native-pause.asm"
%include "patches/offline.asm"
