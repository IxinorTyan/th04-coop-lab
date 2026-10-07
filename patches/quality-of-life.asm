; Display preference is supplied through synchronized input, never local-only
; guest RAM writes. Bit N enables player N's marker while focused.
focus_visible_mask: db 7

; Add just the bonus BEFORE the original award. Its existing full-power
; popup, bullet clear, level/function update and one-time score remain intact.
; R+12 carries each collector's half unit across items and stage changes.
power_pickup_bonus:
    pushad
    cmp byte [0x4664],128
    jae .done
    mov ax,1
    cmp byte [si+14],0
    je .power
    cmp byte [si+14],3
    jne .done
    mov ax,10
.power:
    call resource_index
    cmp byte [cs:player_count],3
    je .add
    add al,[cs:si+12]
    mov ah,al
    and ah,1
    mov [cs:si+12],ah
    xor ah,ah
    shr ax,1
.add:
    add al,[0x4664]
    cmp al,127
    jbe .store
    mov al,127                ; let original pickup trigger Full Power
    mov byte [cs:si+12],0
.store:
    mov [0x4664],al
.done:
    popad
    ret

; A 5x5 black outline and 3x3 white center at the actual collision origin.
; Stays inside player_invalidate's existing sprite rectangle on both pages.
; Draw after all player sprites so overlapping teammates cannot hide it.
focus_points_render:
    pushad
    push es
    xor bp,bp
.player:
    mov ax,1
    mov cx,bp
    shl ax,cl
    mov dl,al
    shl dl,3
    test [cs:focus_visible_mask],dl
    jnz .visible
    test [cs:focus_visible_mask],al
    jz .next
    mov al,[0x3976]
    cmp bp,0
    je .focus
    mov al,[cs:p2_focus]
    cmp bp,1
    je .focus
    mov al,[cs:p3_focus]
.focus:
    test al,al
    jz .next
.visible:
    mov bx,bp
    call player_info
    cmp byte [cs:si+R_OUT],0
    jne .next
    test cx,cx
    jnz .next
    sar ax,4
    add ax,32-2               ; playfield left, marker radius
    mov si,ax
    add dx,(16-2)*16          ; playfield top, marker radius
    push dx
    call ORIGINAL(0xbc10)
    imul di,ax,80
    mov cx,si
    and cx,7
    shr si,3
    add di,si
    mov ax,0x00f8
    ror ax,cl                 ; two-byte mask, including byte crossings
    mov bx,ax
    mov ax,0xa800
    mov es,ax
    mov al,0xc0
    out 0x7c,al
    xor al,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    push di
    mov cx,5
.outline:
    mov [es:di],bx
    call .row
    loop .outline
    pop di
    ; White inner mask is the middle three bits of the five-bit outline.
    mov ax,bx
    rol ax,1
    and ax,bx
    ror bx,1
    and bx,ax
    mov al,0xff
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    out 0x7e,al
    call .row
    mov cx,3
.center:
    mov [es:di],bx
    call .row
    loop .center
.next:
    inc bp
    movzx ax,byte [cs:player_count]
    cmp bp,ax
    jb .player
    xor al,al
    out 0x7c,al
    pop es
    popad
    ret
.row:
    add di,80
    cmp di,32000
    jb .ret
    sub di,32000
.ret:
    ret
