; Rescue progress[3], release latch[3], selected recipient[3].
rescue_state: times 9 db 0
ghost_palette_map: times 11 db 0
rescue_best: dd 0
rescue_pick: db 0
rescue_gx: dw 0
rescue_gy: dw 0

rescue_reset:
    mov dword [cs:rescue_state],0
    mov dword [cs:rescue_state+4],0
    mov byte [cs:rescue_state+8],0
    ret

coop_tick:
    pushad
    call resource_store
    mov ax,[cs:ticks]
    shr ax,3
    and ax,31
    cmp ax,16
    jb .wave
    neg ax
    add ax,31
.wave:
    shr ax,1
    add ax,316
    shl ax,4
    cmp byte [cs:resources+R_OUT],0
    je .p2
    mov word [0x464e],144*16
    mov word [0x4652],144*16
    mov [0x4650],ax
    mov [0x4654],ax
.p2:
    cmp byte [cs:resources+16+R_OUT],0
    je .p3
    mov word [cs:p2_motion+2],240*16
    mov word [cs:p2_motion+6],240*16
    mov [cs:p2_motion+4],ax
    mov [cs:p2_motion+8],ax
.p3:
    cmp byte [cs:player_count],3
    jne .transfer
    cmp byte [cs:resources+32+R_OUT],0
    je .transfer
    mov word [cs:p3_motion+2],192*16
    mov word [cs:p3_motion+6],192*16
    mov [cs:p3_motion+4],ax
    mov [cs:p3_motion+8],ax
.transfer:
    xor bp,bp
.giver:
    mov bx,bp
    call player_info
    mov [cs:rescue_gx],ax
    mov [cs:rescue_gy],dx
    cmp byte [cs:si+R_OUT],0
    jne .reset
    test cx,cx
    jnz .reset
    mov al,[0x3976]
    mov dx,[0x3974]
    test bp,bp
    jz .input
    mov al,[cs:p2_focus]
    mov dx,[cs:p2_input]
    cmp bp,1
    je .input
    mov al,[cs:p3_focus]
    mov dx,[cs:p3_input]
.input:
    test al,al
    jz .reset
    cmp byte [cs:rescue_state+3+bp],0
    jne .next_giver
    test dx,0x30
    jnz .cancel
    cmp byte [cs:si+R_LIVES],2
    jb .cancel
    mov dword [cs:rescue_best],0x7fffffff
    mov byte [cs:rescue_pick],255
    xor bx,bx
.target:
    cmp bx,bp
    je .next_target
    call player_info
    cmp byte [cs:si+R_OUT],2
    je .next_target
    cmp byte [cs:si+R_LIVES],100
    jae .next_target
    cmp byte [cs:si+R_OUT],0
    jne .range
    test cx,cx
    jnz .next_target
.range:
    sub ax,[cs:rescue_gx]
    sub dx,[cs:rescue_gy]
    mov di,ax
    add di,16*16
    cmp di,36*16
    ja .next_target
    mov di,dx
    add di,22*16
    cmp di,44*16
    ja .next_target
    movsx eax,ax
    movsx edx,dx
    imul eax,eax
    imul edx,edx
    add eax,edx
    cmp eax,[cs:rescue_best]
    jae .next_target
    mov [cs:rescue_best],eax
    mov [cs:rescue_pick],bl
.next_target:
    inc bx
    cmp bl,[cs:player_count]
    jb .target
    mov al,[cs:rescue_pick]
    cmp al,255
    je .cancel
    cmp al,[cs:rescue_state+6+bp]
    je .progress
    mov [cs:rescue_state+6+bp],al
    mov byte [cs:rescue_state+bp],0
.progress:
    inc byte [cs:rescue_state+bp]
    cmp byte [cs:rescue_state+bp],90
    jb .next_giver
    mov si,bp
    shl si,4
    add si,resources
    movzx dx,al
    mov di,dx
    shl di,4
    add di,resources
    dec byte [cs:si+R_LIVES]
    inc byte [cs:di+R_LIVES]
    cmp byte [cs:di+R_OUT],0
    je .completed
    shr byte [cs:si+R_BOMBS],1
    mov byte [cs:di+R_BOMBS],1
    mov si,di
    call revive_item_player
    cmp byte [0xbcba],20
    jae .completed
    mov byte [0xbcba],20
.completed:
    mov byte [cs:rescue_state+3+bp],1
    call resource_load
    jmp .next_giver
.reset:
    mov byte [cs:rescue_state+3+bp],0
.cancel:
    mov byte [cs:rescue_state+bp],0
.next_giver:
    inc bp
    movzx ax,byte [cs:player_count]
    cmp bp,ax
    jb .giver
    call resource_load
    mov eax,[0x464e]
    mov [cs:p1_xy],eax
    popad
    ret

stage_revive:
    pushad
    xor dx,dx
    mov si,resources
.slot:
    cmp byte [cs:si+R_OUT],1
    jne .next
    mov word [cs:si+R_LIVES],0x0101
    call revive_item_player
.next:
    add si,RESOURCE_SIZE
    inc dx
    cmp dl,[cs:player_count]
    jb .slot
    call rescue_reset
    popad
    ret

ghosts_invalidate:
    pushad
    push es
    push word [0x4264]
    push word [0x4266]
    mov word [0x4264],48
    mov word [0x4266],64
    xor bp,bp
.slot:
    mov bx,bp
    shl bx,1
    push word 320*16
    push word [cs:spawn_x+bx]
    call ORIGINAL(0xb9d6)
    inc bp
    movzx ax,byte [cs:player_count]
    cmp bp,ax
    jb .slot
    pop word [0x4266]
    pop word [0x4264]
    pop es
    popad
    ret

; Map the approved sprite RGB colors to the CURRENT stage palette. Never
; write the global palette or hardware palette ports.
ghost_match_palette:
    pushad
    xor bp,bp
.source:
    imul si,bp,3
    xor bx,bx
    mov di,0x2a82
    mov edx,0x7fffffff
.candidate:
    xor eax,eax
    xor cx,cx
.channel:
    push bx
    mov bx,cx
    movzx ebx,byte [cs:ghost_rgb+si+bx]
    push si
    mov si,cx
    add si,di
    movzx esi,byte [si]
    sub ebx,esi
    imul ebx,ebx
    add eax,ebx
    pop si
    pop bx
    inc cx
    cmp cx,3
    jb .channel
    ; RGB distance can exceed 65535: use full precision for comparison.
    cmp eax,edx
    jae .skip
    mov edx,eax
    mov [cs:ghost_palette_map+bp],bl
.skip:
    add di,3
    inc bx
    cmp bx,16
    jb .candidate
    inc bp
    cmp bp,11
    jb .source
    popad
    ret

ghosts_render:
    pushad
    push es
    mov al,[cs:resources+R_OUT]
    or al,[cs:resources+16+R_OUT]
    cmp byte [cs:player_count],3
    jne .active
    or al,[cs:resources+32+R_OUT]
.active:
    test al,al
    jz .done
    call ghost_match_palette
    xor bp,bp
.player:
    mov bx,bp
    shl bx,4
    cmp byte [cs:resources+bx+R_OUT],0
    je .next
    mov bx,bp
    call player_info
    push dx
    call ORIGINAL(0xbc10)
    imul di,ax,80
    mov bx,bp
    shl bx,1
    mov ax,[cs:spawn_x+bx]
    shr ax,7
    add ax,2
    add di,ax
.asset:
    mov bx,bp
    shl bx,1
    movzx si,byte [cs:run_config+4+bx]
    imul si,352 ; dictionary indices: 11 colors * 32 rows
    add si,ghost_masks
    mov ax,0xa800
    mov es,ax
    xor bx,bx
.color:
    mov ah,[cs:ghost_palette_map+bx]
    pushf
    cli
    mov al,0xc0
    out 0x7c,al
    mov cx,4
.plane:
    shr ah,1
    sbb al,al
    out 0x7e,al
    loop .plane
    popf
    push di
    mov cx,32
.row:
    push bx
    movzx bx,byte [cs:si]
    shl bx,2
    mov eax,[cs:ghost_rows+bx]
    pop bx
    mov [es:di],eax ; GRCG RMW mask: zero bits preserve the background
    inc si
    add di,80
    cmp di,32000
    jb .nowrap
    sub di,32000
.nowrap:
    loop .row
    pop di
    inc bx
    cmp bx,11
    jb .color
.next:
    inc bp
    movzx ax,byte [cs:player_count]
    cmp bp,ax
    jb .player
    xor al,al
    out 0x7c,al
.done:
    pop es
    popad
    ret

 ; Compact native rescue panel ABOVE HiScore (which begins on text row 3).
; Rows 0..2, columns 56..71: never overwrite score, stocks, points or graze.
rescue_hud:
    pushad
    push es
    mov ax,0xa000
    mov es,ax
    mov di,56*2
    mov dx,3
.clear_row:
    mov cx,16
.clear:
    mov ax,0x0520
    call hud_char
    loop .clear
    add di,160-32
    dec dx
    jnz .clear_row
    xor bp,bp
.player:
    movzx ax,byte [cs:rescue_state+bp]
    test ax,ax
    jz .next
    imul ax,100
    xor dx,dx
    mov cx,90
    div cx
    push ax
    imul di,bp,160
    add di,56*2
    mov ax,bp
    add al,'1'
    mov ah,[cs:hud_colors+bp]
    call hud_char
    mov al,'>'
    call hud_char
    mov al,[cs:rescue_state+6+bp]
    add al,'1'
    mov ah,[cs:hud_colors+bp]
    call hud_char
    mov al,' '
    call hud_char
    pop ax
    push ax
    xor dx,dx
    mov cx,100
    div cx
    push dx
    add al,'0'
    mov ah,0xe1
    call hud_char
    pop ax
    call hud_number
    mov al,'%'
    call hud_char
    mov al,' '
    call hud_char
    pop ax
    imul ax,6
    xor dx,dx
    mov cx,100
    div cx
    mov bx,ax
    mov cx,6
.bar:
    mov ax,0x412e ; dim empty dot
    test bx,bx
    jz .empty
    mov al,'='
    mov ah,[cs:hud_colors+bp]
    cmp byte [cs:rescue_state+bp],90
    jb .pulse
    mov ah,0x81 ; green completion
    jmp .filled
.pulse:
    test byte [cs:ticks],16
    jz .filled
    mov ah,0xe1 ; gentle flash of filled portion
.filled:
    dec bx
.empty:
    call hud_char
    loop .bar
.next:
    inc bp
    movzx ax,byte [cs:player_count]
    cmp bp,ax
    jb .player
.done:
    pop es
    popad
    ret
rescue_title: db 'RESCUE',0

ghost_rgb: incbin "patches/ghosts.bin",0,33
ghost_rows: incbin "build/ghost-rows.bin"
ghost_masks: incbin "build/ghost-indices.bin"
