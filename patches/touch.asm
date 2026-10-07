; Per-seat movement mailbox: flags, pending X/Y in 1/16 px, reserved (8 bytes).
; All bytes belong to the emulated machine and are included in rollback.
touch_state: times 24 db 0
; Published as one dword only after all player banks have been restored.
; Each byte: bit 0 miss, bit 1 entry, bit 2 out. High byte: ready.
touch_status: dd 0
touch_discard_blocked:
    pushad
    xor bx,bx
.slot:
    call player_info
    test ch,ch
    jnz .clear
    cmp byte [cs:si+R_OUT],0
    jne .clear
    test bx,bx
    jnz .guest
    cmp byte [0x4663],0
    jmp .entry
.guest:
    mov di,p2_motion
    cmp bx,1
    je .read
    mov di,p3_motion
.read:
    cmp byte [cs:di+23],0
.entry:
    je .next
.clear:
    mov di,bx
    shl di,3
    mov word [cs:touch_state+di],0
    mov dword [cs:touch_state+di+2],0
.next:
    inc bx
    cmp bx,3
    jb .slot
    popad
    ret
touch_publish_status:
    pushad
    xor edx,edx
    xor bx,bx
.slot:
    call player_info
    xor al,al
    test ch,ch
    setnz al
    cmp byte [cs:si+R_OUT],0
    je .entry
    or al,4
.entry:
    mov di,0x464c
    test bx,bx
    jz .p1
    mov di,p2_motion
    cmp bx,1
    je .guest
    mov di,p3_motion
.guest:
    cmp byte [cs:di+23],0
    jmp .entry_flag
.p1:
    cmp byte [di+23],0
.entry_flag:
    je .pack
    or al,2
.pack:
    movzx eax,al
    mov cx,bx
    shl cx,3
    shl eax,cl
    ; player_info uses DX for Y, so accumulate outside that register.
    push eax
    inc bx
    cmp bx,3
    jb .slot
    pop eax
    pop edx
    or eax,edx
    pop edx
    or eax,edx
    or eax,0x01000000
    mov [cs:touch_status],eax
    popad
    ret
touch_move:
    pushad
    movzx ebx,byte [cs:active_p2]
    shl bx,3
    test word [cs:touch_state+bx],1
    jz .done
    cmp byte [0x466a],0
    jne .clear
    movsx esi,word [cs:touch_state+bx+2]
    movsx edi,word [cs:touch_state+bx+4]
    ; Read actual positions only inside the active native player context.
    movsx eax,word [0x464e]
    add esi,eax
    cmp esi,128
    jge .xmax
    mov esi,128
.xmax:
    cmp esi,6016
    jle .xready
    mov esi,6016
.xready:
    sub esi,eax
    movsx eax,word [0x4650]
    add edi,eax
    cmp edi,128
    jge .ymax
    mov edi,128
.ymax:
    cmp edi,5632
    jle .yready
    mov edi,5632
.yready:
    sub edi,eax
    mov [cs:touch_state+bx+2],si
    mov [cs:touch_state+bx+4],di
    test word [cs:touch_state+bx],2
    jnz .apply
    ; ceil(sqrt(dx*dx+dy*dy)), using integer binary search, no FP state.
    mov eax,esi
    imul eax,eax
    mov edx,edi
    imul edx,edx
    add eax,edx
    xor ecx,ecx
    mov ebp,16384
.sqrt:
    lea edx,[ecx+ebp]
    shr edx,1
    ; Compare squared midpoint without destroying the squared length.
    push edx
    imul edx,edx
    cmp edx,eax
    pop edx
    jb .lower
    mov ebp,edx
    jmp .next
.lower:
    lea ecx,[edx+1]
.next:
    cmp ecx,ebp
    jb .sqrt
    mov ebp,64                ; original TH04 aligned speed is 4 px/frame
    cmp byte [0x3976],0
    je .speed
    mov ebp,32                ; original focus halves the speed
.speed:
    cmp ecx,ebp
    jbe .apply
    mov eax,esi
    imul eax,ebp
    cdq
    idiv ecx
    mov esi,eax
    mov eax,edi
    imul eax,ebp
    cdq
    idiv ecx
    mov edi,eax
.apply:
    mov [0x4656],si
    mov [0x4658],di
    sub [cs:touch_state+bx+2],si
    sub [cs:touch_state+bx+4],di
    jmp .done
.clear:
    mov dword [cs:touch_state+bx+2],0
.done:
    popad
    jmp ORIGINAL(0x10950)     ; original prev-position update and bounds clamp
