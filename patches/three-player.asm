; Guest-bank selection always begins and ends on P2 outside a callback.
; The original single-player context is never duplicated for world updates.
guest_slot: db 1
p3_input: dw 0
p3_focus: db 0
p3_motion: times 24 db 0
p3_flags: times 5 db 0
p3_options: times 8 db 0
p3_explosion: times 3 db 0
p3_laser: times 16 db 0
p3_ring: db 0
p3_grazed: times 440 db 0
p3_ages: times 440 db 0
spawn_x: dw 144*16,240*16,192*16
aim_best: dd 0
aim_x: dw 0
aim_y: dw 0
aim_slot: db 0

init_third:
    pushad
    push ds
    push es
    push cs
    pop ds
    push cs
    pop es
    mov si,p2_motion
    mov di,p3_motion
    mov cx,40
    rep movsb
    xor ax,ax
    mov di,p3_laser
    mov cx,17+440+440
    rep stosb
    mov di,damage_state
    mov cx,16
    rep stosb
    mov word [p3_input],0
    mov byte [p3_focus],0
    mov word [p3_motion+2],192*16
    mov word [p3_motion+6],192*16
    pop es
    pop ds
    popad
    ret

guest_bank:
    pushad
    push ds
    push cs
    pop ds
    mov si,p2_motion
    mov di,p3_motion
    mov cx,40
    call swap_bytes
    mov si,p2_laser
    mov di,p3_laser
    mov cx,17
    call swap_bytes
    xor byte [guest_slot],3
    pop ds
    popad
    ret

for_guests:
    pushad
    movzx cx,byte [cs:player_count]
    dec cx
.slot:
    push cx
    push bx
    call bx
    pop bx
    pop cx
    cmp byte [cs:player_count],3
    jne .next
    call guest_bank
.next:
    loop .slot
    popad
    ret

guest_out:
    push bx
    movzx bx,byte [cs:guest_slot]
    shl bx,4
    cmp byte [cs:resources+bx+R_OUT],0
    pop bx
    ret

; BX logical player -> SI resource slot, AX/DX position, CX hit/miss flags.
; Used only with P1 bound and the inactive bank restored to P2.
player_info:
    mov si,bx
    shl si,4
    add si,resources
    test bx,bx
    jnz .guest
    mov ax,[0x464e]
    mov dx,[0x4650]
    mov cx,[0x4669]
    ret
.guest:
    mov ax,[cs:p2_motion+2]
    mov dx,[cs:p2_motion+4]
    mov cx,[cs:p2_flags+3]
    cmp bx,1
    je .done
    mov ax,[cs:p3_motion+2]
    mov dx,[cs:p3_motion+4]
    mov cx,[cs:p3_flags+3]
.done:
    ret

; Effective HP scaling: rational damage with a carried fraction avoids making
; 1-damage shots ineffective. Reset the fraction on every phase/threshold
; change. The original HP thresholds, HP bar and timed phases stay intact.
boss_damage_scale:
    push cs
    call ORIGINAL(0x105b9)
    cmp byte [0x1b5c],1
    jne .scale
    cmp word [ss:bp+4],10 ; invincible hit sound: no HP will be consumed
    je .done
    cmp word [ss:bp+2],0x3f3e ; Marisa's extra resistance divides later
    je .done
.scale:
    push bx
    mov bx,0
    call scale_damage
    pop bx
.done:
    retf
midboss_damage_scale:
    push cs
    call ORIGINAL(0x105b9)
    push bx
    mov bx,8
    call scale_damage
    pop bx
    retf
resistant_boss_damage:
    ; Marisa's native phase resistance was already divided out at 179DDh.
    push bx
    mov bx,0
    call scale_damage
    pop bx
    sub [0x53d6],ax
    mov ax,[0x53d6] ; displaced instructions
    retf
damage_state: times 16 db 0 ; remainder, phase key, threshold, last phase frame
scale_damage:
    push cx
    push dx
    push si
    push di
    mov si,damage_state
    add si,bx
    movzx cx,byte [0x53d9]
    mov dx,[0x53e0]
    mov di,[0x53da]
    cmp bx,8
    jne .key
    movzx cx,byte [0x53c5]
    xor dx,dx
    mov di,[0x53c6]
.key:
    cmp cx,[cs:si+2]
    jne .reset
    cmp dx,[cs:si+4]
    jne .reset
    cmp di,[cs:si+6]
    jb .reset
    jmp .divide
.reset:
    mov word [cs:si],0
.divide:
    mov [cs:si+2],cx
    mov [cs:si+4],dx
    mov [cs:si+6],di
    mov cx,10
    mul cx
    add ax,[cs:si]
    adc dx,0
    mov cx,15
    cmp byte [cs:player_count],3
    jne .denominator
    mov cx,22
.denominator:
    div cx
    mov [cs:si],dx
    pop di
    pop si
    pop dx
    pop cx
    ret
